/**
 * Consumer webmail domains.
 *
 * Why this exists: SpamAssassin's FREEMAIL_FORGED_REPLYTO rule fires when the
 * From is on a business domain but the Reply-To is a free webmail address —
 * the classic phishing shape. Sollos does exactly that by default: it sends
 * "Acme Cleaning <noreply@sollos3.com>" and drops the owner's contact address
 * into Reply-To, and for a small cleaning company that address is nearly
 * always a Gmail. A mail-tester run on a real invoice on 2026-09-15 scored
 * -2.503 on this rule alone, on every client-facing email we have ever sent.
 *
 * Deliberately narrow: only genuine freemail providers, matching what
 * SpamAssassin itself treats as freemail. ISP mailboxes (shaw.ca, rogers.com,
 * sympatico.ca) are NOT freemail and must stay out — listing them would
 * suppress Reply-To, and cost the org its client replies, for no
 * deliverability gain at all.
 */

import { emailDomain } from "@/lib/disposable-domains";

const FREEMAIL = new Set<string>([
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft
  "hotmail.com", "hotmail.co.uk", "hotmail.ca", "hotmail.fr", "hotmail.de", "hotmail.it", "hotmail.es",
  "outlook.com", "outlook.co.uk", "outlook.fr", "outlook.de", "outlook.es", "outlook.it",
  "live.com", "live.ca", "live.co.uk", "live.fr", "live.de", "live.nl", "live.it",
  "msn.com", "passport.com",
  // Yahoo
  "yahoo.com", "yahoo.ca", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.it", "yahoo.es",
  "yahoo.com.au", "yahoo.co.in", "yahoo.com.br", "ymail.com", "rocketmail.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // AOL
  "aol.com", "aim.com", "aol.co.uk", "aol.de",
  // Privacy-focused
  "protonmail.com", "protonmail.ch", "proton.me", "pm.me",
  "tutanota.com", "tutanota.de", "tuta.io", "hushmail.com",
  // GMX / Mail.com family
  "gmx.com", "gmx.net", "gmx.de", "gmx.at", "gmx.ch", "gmx.co.uk",
  "mail.com", "email.com", "usa.com", "consultant.com",
  // Yandex / Mail.ru
  "yandex.com", "yandex.ru", "yandex.by", "yandex.kz", "ya.ru",
  "mail.ru", "inbox.ru", "list.ru", "bk.ru",
  // Other mainstream webmail
  "zoho.com", "zohomail.com", "fastmail.com", "fastmail.fm",
  "hey.com", "mailfence.com", "posteo.de", "runbox.com",
  "web.de", "t-online.de", "freenet.de",
  "libero.it", "virgilio.it", "tiscali.it", "alice.it",
  "orange.fr", "wanadoo.fr", "free.fr", "laposte.net", "sfr.fr",
  "seznam.cz", "wp.pl", "o2.pl", "interia.pl", "onet.pl",
  "qq.com", "163.com", "126.com", "sina.com", "naver.com", "daum.net",
  "rediffmail.com", "sapo.pt", "terra.com.br", "uol.com.br", "bol.com.br",
]);

/**
 * True when the address is on a consumer webmail provider.
 *
 * Case-insensitive. Sub-domains of a listed domain count too, so a
 * vanity host on a freemail provider is caught the same way
 * isDisposableEmail() handles them.
 */
export function isFreemailAddress(email: string | null | undefined): boolean {
  const d = emailDomain(email);
  if (!d) return false;
  if (FREEMAIL.has(d)) return true;
  const parts = d.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    if (FREEMAIL.has(parts.slice(i).join("."))) return true;
  }
  return false;
}
