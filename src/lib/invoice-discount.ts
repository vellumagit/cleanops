/**
 * Discount lines, for the books.
 *
 * In Sollos a discount is an invoice line with a negative price
 * (migration 20261115040000_invoice_discount_lines.sql). Sage and QuickBooks
 * each have their own idea of a discount, and neither is certain to accept
 * a negative sales line. So the books never see one: the discount is spread
 * across the ordinary lines in proportion to their size, and each goes over
 * as one line at its reduced amount. The line detail survives, every amount
 * is positive, and the lines still add up to the invoice's pre-tax total to
 * the cent.
 */

export type BooksLine = { description: string; quantity: number; unitPriceCents: number };

export function spreadDiscounts(lines: readonly BooksLine[]): BooksLine[] {
  const net = (l: BooksLine) => Math.round(l.quantity * l.unitPriceCents);
  const discounts = lines.filter((l) => net(l) < 0);
  if (discounts.length === 0) return [...lines];

  const charged = lines.filter((l) => net(l) > 0);
  const chargedTotal = charged.reduce((sum, l) => sum + net(l), 0);
  const off = -discounts.reduce((sum, l) => sum + net(l), 0);
  // Nothing sensible to spread over, or more off than there is: one line for
  // what is left, so the books still match the invoice.
  if (charged.length === 0 || off >= chargedTotal) {
    return [{ description: "Services (after discount)", quantity: 1, unitPriceCents: Math.max(0, chargedTotal - off) }];
  }

  let given = 0;
  return charged.map((l, i) => {
    const share = i === charged.length - 1 ? off - given : Math.round((net(l) * off) / chargedTotal);
    given += share;
    return { description: `${l.description} (less discount)`, quantity: 1, unitPriceCents: net(l) - share };
  });
}
