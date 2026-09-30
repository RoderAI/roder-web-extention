export function keyParams(chord: string): Record<string, unknown> {
  const parts = chord.length === 1 ? [chord] : chord.split("+");
  const named: Record<string, [string, string, number]> = {
    Enter: ["Enter", "Enter", 13],
    Tab: ["Tab", "Tab", 9],
    Escape: ["Escape", "Escape", 27],
    Esc: ["Escape", "Escape", 27],
    Backspace: ["Backspace", "Backspace", 8],
    Delete: ["Delete", "Delete", 46],
    Space: [" ", "Space", 32],
    ArrowLeft: ["ArrowLeft", "ArrowLeft", 37],
    ArrowUp: ["ArrowUp", "ArrowUp", 38],
    ArrowRight: ["ArrowRight", "ArrowRight", 39],
    ArrowDown: ["ArrowDown", "ArrowDown", 40],
    Home: ["Home", "Home", 36],
    End: ["End", "End", 35],
    PageUp: ["PageUp", "PageUp", 33],
    PageDown: ["PageDown", "PageDown", 34],
  };
  let modifiers = 0;
  for (const modifier of parts.slice(0, -1)) {
    const mask = (
      { Control: 2, Ctrl: 2, Alt: 1, Shift: 8, Meta: 4, Command: 4 } as Record<
        string,
        number
      >
    )[modifier];
    if (!mask) throw new Error(`Unsupported key modifier: ${modifier}`);
    modifiers |= mask;
  }
  const key = parts.at(-1)!;
  const spec =
    named[key] ??
    (key.length === 1
      ? [
          key,
          /[a-z]/i.test(key)
            ? `Key${key.toUpperCase()}`
            : /[0-9]/.test(key)
              ? `Digit${key}`
              : "",
          key.toUpperCase().charCodeAt(0),
        ]
      : undefined);
  if (!spec) throw new Error(`Unsupported key: ${key}`);
  return {
    key: modifiers & 8 && key.length === 1 ? spec[0].toUpperCase() : spec[0],
    code: spec[1],
    windowsVirtualKeyCode: spec[2],
    modifiers,
    text:
      (modifiers & ~8) === 0 && (key.length === 1 || key === "Space")
        ? modifiers & 8
          ? spec[0].toUpperCase()
          : spec[0]
        : key === "Enter" && modifiers === 0
          ? "\r"
          : undefined,
  };
}
