"use client";

import { useEffect } from "react";

/**
 * Keeps `--app-vh` (the height of what is actually visible, in px) on <html>
 * while a fill-screen pane is mounted. See the FILL-SCREEN block in
 * globals.css.
 *
 * `100dvh` follows the browser's toolbars but not the on-screen keyboard:
 * on iOS, and on Android Chrome since 108, the keyboard covers the bottom
 * of the page and the browser slides the whole page up to keep the caret
 * in view. In a chat that is the header leaving the screen every time
 * someone taps the message box. The visual viewport does shrink for the
 * keyboard, so the shell is sized from it and the page is put back at the
 * top, which leaves the message box sitting on the keyboard.
 *
 * Pinch-zoom shrinks the visual viewport too. Sizing the page to a zoomed
 * viewport would crush it, so while zoomed the variable is removed and the
 * CSS falls back to 100dvh.
 */
/** No browser toolbar is this tall; an on-screen keyboard always is. */
const KEYBOARD_MIN_PX = 150;

export function useVisibleHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    // The tallest the visible area has been at this width: the screen with
    // no keyboard. Compared against that rather than against the page's own
    // height, because browsers disagree about the page: iOS and Chrome
    // leave it alone when the keyboard opens, Firefox on Android shrinks it
    // too, and then "visible vs page" sees no keyboard at all. Turning the
    // phone changes the width, which starts the measure again.
    let tallest = vv.height;
    let widthThen = vv.width;
    // What --app-vh was last set to. The visible height arrives in fractions
    // of a pixel and wobbles by one while a browser toolbar settles; writing
    // every wobble re-laid the whole pane each time, which showed as the
    // chat trembling in place (hand test, 2026-11-18). A change under 2px is
    // not a keyboard or a toolbar, so it is left alone.
    let written: number | null = null;

    const apply = (movedOnly: boolean) => {
      if (Math.abs(vv.scale - 1) > 0.01) {
        root.style.removeProperty("--app-vh");
        delete root.dataset.keyboard;
        written = null;
        return;
      }
      if (Math.abs(vv.width - widthThen) > 1) {
        widthThen = vv.width;
        tallest = vv.height;
      }
      tallest = Math.max(tallest, vv.height);
      const height = Math.round(vv.height);
      if (written === null || Math.abs(height - written) >= 2) {
        written = height;
        root.style.setProperty("--app-vh", `${height}px`);
      }
      // The keyboard is up when far less is visible than the screen shows
      // without it. The fill-screen rules use this to give the page heading,
      // banners and the tab bar's reserved space back to the pane
      // (globals.css): at 350px visible they left a chat next to nothing.
      const keyboardOpen = tallest - vv.height > KEYBOARD_MIN_PX;
      if (keyboardOpen) root.dataset.keyboard = "open";
      else delete root.dataset.keyboard;
      // The browser may already have slid the page to reach the caret: put
      // it back. When the viewport only MOVED (a scroll event) and there is
      // no keyboard, leave it: that is a finger dragging the page, the
      // browser springs it back by itself, and snapping it to the top on
      // every event of the drag fought the browser the whole way.
      if (window.scrollY !== 0 && (keyboardOpen || !movedOnly)) window.scrollTo(0, 0);
    };

    // One pass per frame however many events arrive in it.
    let frame = 0;
    let sawResize = false;
    const schedule = (resized: boolean) => {
      sawResize = sawResize || resized;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const movedOnly = !sawResize;
        sawResize = false;
        apply(movedOnly);
      });
    };
    const onResize = () => schedule(true);
    const onScroll = () => schedule(false);

    apply(false);
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onScroll);
      root.style.removeProperty("--app-vh");
      delete root.dataset.keyboard;
    };
  }, []);
}
