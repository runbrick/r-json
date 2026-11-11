import { Menu, Submenu, type MenuItemOptions, type PredefinedMenuItemOptions } from "@tauri-apps/api/menu";

// Keep the native resources and their action callbacks alive for the app lifetime.
let appMenu: Menu | undefined;

export async function initializeMacosMenu() {
  if (appMenu) return;

  const businessMenus: Submenu[] = [];
  for (const [menuIndex, element] of Array.from(document.querySelectorAll<HTMLElement>("#menubar > .menu")).entries()) {
    const items: (MenuItemOptions | PredefinedMenuItemOptions)[] = [];
    for (const [itemIndex, child] of Array.from(element.querySelector(".menu-panel")!.children).entries()) {
      if (child.classList.contains("divider")) {
        items.push({ item: "Separator" });
      } else if (child instanceof HTMLButtonElement) {
        const label = child.cloneNode(true) as HTMLButtonElement;
        label.querySelector("kbd")?.remove();
        items.push({
          id: `business-menu-${menuIndex}-${itemIndex}`,
          text: label.textContent!.trim(),
          accelerator: child.dataset.nativeAccelerator,
          action: () => child.click(),
        });
      }
    }
    if (menuIndex === 0) {
      items.push({ item: "Separator" }, { item: "CloseWindow", text: "关闭窗口" });
    }
    businessMenus.push(await Submenu.new({
      text: element.querySelector(".menu-trigger")!.textContent!.trim(),
      items,
    }));
  }

  const [file, tools, help] = businessMenus;
  const windowMenu = await Submenu.new({
    text: "窗口",
    items: [
      { item: "Minimize", text: "最小化" },
      { item: "Maximize", text: "缩放" },
      { item: "Separator" },
      { item: "BringAllToFront", text: "前置全部窗口" },
    ],
  });
  const menu = await Menu.new({
    items: [
      {
        text: "R JSON",
        items: [
          { item: { About: null }, text: "关于 R JSON" },
          { item: "Separator" },
          { item: "Services", text: "服务" },
          { item: "Separator" },
          { item: "Hide", text: "隐藏 R JSON" },
          { item: "HideOthers", text: "隐藏其他" },
          { item: "ShowAll", text: "显示全部" },
          { item: "Separator" },
          { item: "Quit", text: "退出 R JSON" },
        ],
      },
      file,
      {
        text: "编辑",
        items: [
          { item: "Undo", text: "撤销" },
          { item: "Redo", text: "重做" },
          { item: "Separator" },
          { item: "Cut", text: "剪切" },
          { item: "Copy", text: "拷贝" },
          { item: "Paste", text: "粘贴" },
          { item: "SelectAll", text: "全选" },
        ],
      },
      { text: "显示", items: [{ item: "Fullscreen", text: "切换全屏" }] },
      tools,
      windowMenu,
      help,
    ],
  });
  await menu.setAsAppMenu();
  appMenu = menu;
  // Hide the in-window menus only after their native replacements are installed.
  document.documentElement.dataset.nativeMenu = "true";
  await windowMenu.setAsWindowsMenuForNSApp();
  await help.setAsHelpMenuForNSApp();
}
