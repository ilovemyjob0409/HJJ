// 全站彈窗層疊註冊表：Esc 與 Tab 圈限只作用於最上層彈窗
// （例：照片燈箱疊在活動詳情 Modal 上時，Esc 先關燈箱再關 Modal）。
interface DialogHandle {
  isTop: () => boolean;
  unregister: () => void;
}

const stack: symbol[] = [];

export function registerDialog(): DialogHandle {
  const id = Symbol('dialog');
  stack.push(id);
  return {
    isTop: () => stack[stack.length - 1] === id,
    unregister: () => {
      const i = stack.lastIndexOf(id);
      if (i !== -1) stack.splice(i, 1);
    },
  };
}

export function dialogStackSize(): number {
  return stack.length;
}
