export interface LineSpan {
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
}

const DIRECT_LIMIT = 1_200;

/** Line-level diff. Short ranges use Myers; long files fall back to unique-line anchors. */
export function diffLines(leftText: string, rightText: string): LineSpan[] {
  if (leftText === rightText) return [];
  const left = leftText.split(/\r?\n/);
  const right = rightText.split(/\r?\n/);
  let start = 0;
  const shared = Math.min(left.length, right.length);
  while (start < shared && left[start] === right[start]) start += 1;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  const spans = leftEnd - start <= DIRECT_LIMIT && rightEnd - start <= DIRECT_LIMIT
    ? myers(left, right, start, leftEnd, start, rightEnd)
    : anchored(left, right, start, leftEnd, start, rightEnd);
  return spans.filter((span) => span.leftCount > 0 || span.rightCount > 0);
}

function myers(left: string[], right: string[], leftFrom: number, leftTo: number, rightFrom: number, rightTo: number): LineSpan[] {
  const width = leftTo - leftFrom + (rightTo - rightFrom);
  if (width === 0) return [];
  const trace: Int32Array[] = [];
  const farthest = new Int32Array(2 * width + 1);
  const offset = width;
  farthest[offset + 1] = leftFrom;
  let found = false;
  for (let depth = 0; depth <= width && !found; depth += 1) {
    trace.push(farthest.slice());
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const slot = offset + diagonal;
      const down = diagonal === -depth || (diagonal !== depth && farthest[slot - 1] < farthest[slot + 1]);
      let x = down ? farthest[slot + 1] : farthest[slot - 1] + 1;
      let y = x - diagonal - leftFrom + rightFrom;
      while (x < leftTo && y < rightTo && left[x] === right[y]) {
        x += 1;
        y += 1;
      }
      farthest[slot] = x;
      if (x >= leftTo && y >= rightTo) found = true;
    }
  }
  if (!found) {
    return [{ leftStart: leftFrom, leftCount: leftTo - leftFrom, rightStart: rightFrom, rightCount: rightTo - rightFrom }];
  }

  let x = leftTo;
  let y = rightTo;
  const hunks: LineSpan[] = [];
  for (let depth = trace.length - 1; depth > 0; depth -= 1) {
    const snapshot = trace[depth];
    const diagonal = x - y - leftFrom + rightFrom;
    const slot = offset + diagonal;
    const down = diagonal === -depth || (diagonal !== depth && snapshot[slot - 1] < snapshot[slot + 1]);
    const previousX = down ? snapshot[slot + 1] : snapshot[slot - 1];
    const previousDiagonal = down ? diagonal + 1 : diagonal - 1;
    const previousY = previousX - previousDiagonal - leftFrom + rightFrom;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
    }
    if (down && x === previousX) {
      hunks.push({ leftStart: x, leftCount: 0, rightStart: y - 1, rightCount: 1 });
      y -= 1;
    } else if (x !== previousX) {
      hunks.push({ leftStart: x - 1, leftCount: 1, rightStart: y, rightCount: 0 });
      x -= 1;
    }
  }
  return mergeSpans(hunks.reverse());
}

function anchored(left: string[], right: string[], leftFrom: number, leftTo: number, rightFrom: number, rightTo: number): LineSpan[] {
  const rightOnce = uniqueLineIndex(right, rightFrom, rightTo);
  const spans: LineSpan[] = [];
  let leftCursor = leftFrom;
  let rightCursor = rightFrom;
  for (let index = leftFrom; index < leftTo; index += 1) {
    const match = rightOnce.get(left[index]);
    if (match === undefined || match < rightCursor) continue;
    pushGap(spans, leftCursor, index, rightCursor, match);
    leftCursor = index + 1;
    rightCursor = match + 1;
  }
  pushGap(spans, leftCursor, leftTo, rightCursor, rightTo);
  return spans;
}

function uniqueLineIndex(lines: string[], from: number, to: number): Map<string, number> {
  const seen = new Map<string, number>();
  const duplicated = new Set<string>();
  for (let index = from; index < to; index += 1) {
    const line = lines[index];
    if (duplicated.has(line)) continue;
    if (seen.has(line)) {
      seen.delete(line);
      duplicated.add(line);
      continue;
    }
    seen.set(line, index);
  }
  return seen;
}

function pushGap(spans: LineSpan[], leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  if (leftStart === leftEnd && rightStart === rightEnd) return;
  spans.push({
    leftStart,
    leftCount: leftEnd - leftStart,
    rightStart,
    rightCount: rightEnd - rightStart,
  });
}

function mergeSpans(spans: LineSpan[]): LineSpan[] {
  const merged: LineSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...span });
      continue;
    }
    const touches = last.leftStart + last.leftCount === span.leftStart
      && last.rightStart + last.rightCount === span.rightStart;
    if (touches) {
      last.leftCount += span.leftCount;
      last.rightCount += span.rightCount;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}
