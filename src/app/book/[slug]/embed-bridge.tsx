"use client";

import { useEffect } from "react";

/**
 * Inside a company's website (public/embed/book.js made the frame): tell
 * the website how tall the page is, every time that changes, so the frame
 * fits it. Measures the page's own box, not the window: the window is the
 * frame, and measuring it would only ever let the frame grow.
 *
 * Does nothing when the page is opened on its own.
 */
export function EmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const root = document.querySelector<HTMLElement>("[data-embed-root]");
    if (!root) return;
    let last = 0;
    const tell = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      // The height is all it says, and it says it to whoever framed it.
      window.parent.postMessage({ type: "sollos:height", height }, "*");
    };
    tell();
    const watch = new ResizeObserver(tell);
    watch.observe(root);
    return () => watch.disconnect();
  }, []);
  return null;
}
