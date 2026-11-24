/*
 * A company's Sollos booking page, inside the company's own website.
 *
 * The company pastes, where the booking page should appear:
 *
 *   <script src="https://sollos3.com/embed/book.js" data-company="their-name"></script>
 *
 * This puts the page in a frame at that spot and keeps the frame as tall as
 * the page inside it, so there is never a scroll bar within a scroll bar.
 * The page tells us its height (src/app/book/[slug]/embed-bridge.tsx); we
 * believe only the frame we made, from the address we loaded it from.
 *
 * Plain old JavaScript on purpose: it runs on whatever the company's website
 * builder is.
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var slug = script.getAttribute("data-company");
  if (!slug) return;

  // "https://sollos3.com" out of "https://sollos3.com/embed/book.js": the
  // browser always gives a script's src as a full address.
  var origin = script.src.split("/").slice(0, 3).join("/");

  var frame = document.createElement("iframe");
  frame.src = origin + "/book/" + encodeURIComponent(slug) + "?embed=1";
  frame.title = script.getAttribute("data-title") || "Book a clean";
  frame.setAttribute("data-sollos-booking", slug);
  frame.style.cssText =
    "display:block;width:100%;max-width:760px;margin:0 auto;border:0;height:900px;overflow:hidden;background:transparent";
  script.parentNode.insertBefore(frame, script);

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== "sollos:height" || typeof data.height !== "number") return;
    if (data.height > 0 && data.height < 20000) frame.style.height = Math.ceil(data.height) + "px";
  });
})();
