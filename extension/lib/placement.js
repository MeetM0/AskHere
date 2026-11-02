// Where to put the AI window so it sits next to the highlighted text.

/**
 * Put the window next to the text: below it if there's room, otherwise above,
 * otherwise beside it; always kept on screen.
 * anchor/screen are in screen coordinates (CSS px), sent by content.js.
 */
export function placeWindow(anchor, screen, size) {
  const width = Math.min(size.width, screen?.availWidth || size.width);
  const height = Math.min(size.height, screen?.availHeight || size.height);
  if (!anchor || !screen) return { width, height };

  const minX = screen.availLeft;
  const minY = screen.availTop;
  const maxX = screen.availLeft + screen.availWidth - width;
  const maxY = screen.availTop + screen.availHeight - height;
  const gap = 12;

  let left = anchor.left;
  let top;
  if (anchor.bottom + gap + height <= minY + screen.availHeight) {
    top = anchor.bottom + gap; // below
  } else if (anchor.top - gap - height >= minY) {
    top = anchor.top - gap - height; // above
  } else {
    // beside: to the right of the text if it fits, else to the left
    top = anchor.top - 40;
    left = anchor.right + gap + width <= minX + screen.availWidth ? anchor.right + gap : anchor.left - gap - width;
  }
  return {
    width,
    height,
    left: Math.round(clamp(left, minX, maxX)),
    top: Math.round(clamp(top, minY, maxY)),
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
