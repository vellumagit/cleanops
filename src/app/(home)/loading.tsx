/**
 * The front page's own streaming fallback: nothing.
 *
 * Without this, the nearest boundary is src/app/loading.tsx — the full-screen
 * black SollosLoader. The page awaits a session check before it renders, so
 * every visit to sollos3.com streamed that splash first: a black flash before
 * the landing page, and its two logo PNGs downloaded ahead of the hero. For a
 * signed-out visitor the check is quick, so an empty moment is the better
 * fallback. (The route group exists only to hold this file; it doesn't change
 * the URL.)
 */
export default function HomeLoading() {
  return null;
}
