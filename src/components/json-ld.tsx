/**
 * Renders schema.org structured data as a plain <script> tag — Next's own
 * recommendation (node_modules/next/dist/docs/01-app/02-guides/json-ld.md);
 * next/script is for executable code, which this isn't.
 *
 * `<` is escaped to < so a string inside the data can never close the
 * script tag early. Everything passed here is first-party today, but a help
 * article or FAQ answer is one copy-paste away from containing markup.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
