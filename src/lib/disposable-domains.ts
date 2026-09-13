/**
 * Throwaway inboxes. The Sep 11 spammer signed up and created victims with
 * yopmail, airhemp and 94an addresses; none of them is somewhere a cleaning
 * company or its customer keeps mail. Refused at signup and when a client
 * is created, with a plain sentence.
 *
 * Deliberately a list, not a lookup service: it costs nothing at request
 * time, it never phones home, and a miss is a nuisance rather than a
 * breach because the daily caps and the tripwire sit behind it.
 */
const DISPOSABLE = new Set<string>([
  "yopmail.com", "yopmail.fr", "yopmail.net", "cool.fr.nf", "jetable.fr.nf", "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj", "speed.1s.fr", "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf", "monmail.fr.nf",
  "airhemp.com", "94an.com", "mailinator.com", "mailinator.net", "mailinator2.com", "sogetthis.com", "mailin8r.com", "mailinater.com", "spamherelots.com", "thisisnotmyrealemail.com", "binkmail.com", "bobmail.info", "chammy.info", "devnullmail.com", "letthemeatspam.com", "mailinator.us", "notmailinator.com", "reallymymail.com", "reconmail.com", "safetymail.info", "sendspamhere.com", "spamhereplease.com", "streetwisemail.com", "suremail.info", "tradermail.info", "veryrealemail.com", "zippymail.info",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz", "guerrillamail.de", "guerrillamail.info", "guerrillamailblock.com", "grr.la", "sharklasers.com", "spam4.me", "pokemail.net",
  "10minutemail.com", "10minutemail.net", "10minutemail.de", "10minemail.com", "10minutesmail.com", "20minutemail.com", "20mail.it", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmail.net", "tempmail.de", "tempmailo.com", "tempr.email", "tempail.com", "tmpmail.org", "tmpmail.net", "tmpeml.com", "tmails.net", "temporary-mail.net", "throwawaymail.com", "throwam.com", "trashmail.com", "trashmail.at", "trashmail.io", "trashmail.me", "trashmail.net", "trashmail.xyz", "trash-mail.com", "trash-mail.at", "kurzepost.de", "objectmail.com", "proxymail.eu", "rcpt.at", "trash-mail.de", "wegwerfmail.de", "wegwerfmail.net", "wegwerfmail.org", "wegwerfemail.de",
  "dispostable.com", "discard.email", "discardmail.com", "discardmail.de", "spamgourmet.com", "spamgourmet.net", "spamgourmet.org", "mytrashmail.com", "mt2009.com", "mt2014.com", "mt2015.com", "thankyou2010.com", "trash2009.com", "mailnesia.com", "mailnull.com", "spamfree24.org", "spamfree24.de", "spamfree24.eu", "spamfree24.info", "spamfree24.net",
  "getnada.com", "nada.email", "getairmail.com", "airmail.cc", "fakeinbox.com", "fakemail.net", "fakemailgenerator.com", "emailondeck.com", "mohmal.com", "mohmal.im", "mohmal.in", "mohmal.tech", "burnermail.io", "maildrop.cc", "mailcatch.com", "mailexpire.com", "mailforspam.com", "mailfreeonline.com", "mailme.lv", "mailmetrash.com", "mailmoat.com", "mailnator.com", "mailscrap.com", "mailslite.com", "mailtemp.info", "mailtome.de", "mailtothis.com", "mailzilla.com", "mailzilla.org",
  "inboxbear.com", "inboxkitten.com", "inboxalias.com", "harakirimail.com", "hmamail.com", "imgof.com", "imails.info", "incognitomail.com", "incognitomail.net", "incognitomail.org", "instantemailaddress.com", "jetable.com", "jetable.net", "jetable.org", "jnxjn.com", "kasmail.com", "klzlk.com", "koszmail.pl", "lhsdv.com", "lifebyfood.com", "lookugly.com", "lr78.com", "lroid.com",
  "emailtemporario.com.br", "emailtemporanea.com", "emailtemporanea.net", "email-fake.com", "emailfake.com", "fakemail.fr", "tempemail.co", "tempemail.net", "tempinbox.com", "tempinbox.co.uk", "tempomail.fr", "temporarymail.org", "temporaryemail.net", "temporaryinbox.com", "temporaryforwarding.com", "tempsky.com", "tempthe.net", "thankyou2010.com", "thc.st", "throwawayemailaddress.com", "tilien.com", "tmailinator.com", "tradermail.info", "trbvm.com", "trillianpro.com", "tyldd.com", "uggsrock.com", "upliftnow.com", "uplipht.com", "venompen.com", "veryrealemail.com", "viditag.com", "viewcastmedia.com", "viewcastmedia.net", "viewcastmedia.org", "wh4f.org", "whyspam.me", "willselfdestruct.com", "winemaven.info", "wronghead.com", "wuzup.net", "wuzupmail.net", "www.e4ward.com", "www.mailinator.com", "wwwnew.eu", "xagloo.com", "xemaps.com", "xents.com", "xmaily.com", "xoxy.net", "yep.it", "yogamaven.com", "yopmail.gq", "yuurok.com", "zehnminutenmail.de", "zippymail.info", "zoemail.org", "zomg.info",
  "1secmail.com", "1secmail.net", "1secmail.org", "esiix.com", "wwjmp.com", "xojxe.com", "yoggm.com", "dcctb.com", "kzccv.com", "qiott.com", "rteet.com", "uorak.com", "vddaz.com", "xdvsagsdg.com", "zbock.com", "bheps.com", "cuoly.com", "dpptd.com", "ezztt.com", "laste.ml", "vjuum.com",
  "mail.tm", "mailsac.com", "guerrillamail.info", "spambog.com", "spambog.de", "spambog.ru", "spamex.com", "spamavert.com", "spamcannon.com", "spamcannon.net", "spamcero.com", "spamcorptastic.com", "spamday.com", "spamgoes.in", "spaminator.de", "spamkill.info", "spaml.com", "spaml.de", "spammotel.com", "spamobox.com", "spamoff.de", "spamslicer.com", "spamspot.com", "spamthis.co.uk", "spamthisplease.com", "spamtrail.com", "spamtroll.net",
  "mailslurp.com", "mailslurp.net", "mailosaur.net", "mailosaur.io", "testmail.app", "inboxes.app", "ethereal.email", "tempmail.plus", "tempmail.lol", "emailnator.com", "gmailnator.com", "fakemailgenerator.net", "mailpoof.com", "moakt.com", "moakt.co", "moakt.ws", "tmail.ws", "tmpbox.net", "mintemail.com", "mytemp.email", "crazymailing.com", "dropmail.me", "10mail.org", "yomail.info", "emltmp.com", "spymail.one", "tempmailaddress.com", "internxt.com",
]);

/** The domain half of an address, lower-cased, or null when there isn't one. */
export function emailDomain(email: string | null | undefined): string | null {
  const at = (email ?? "").trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return null;
  const d = (email ?? "").trim().toLowerCase().slice(at + 1);
  return d || null;
}

export function isDisposableEmail(email: string | null | undefined): boolean {
  const d = emailDomain(email);
  if (!d) return false;
  if (DISPOSABLE.has(d)) return true;
  // Sub-domains of a listed domain (mail.yopmail.com) count too.
  const parts = d.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  }
  return false;
}

export const DISPOSABLE_EMAIL_MESSAGE =
  "That looks like a throwaway inbox. Please use a real business or personal email address.";
