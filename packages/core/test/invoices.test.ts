import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  addTaxRegistration, BuiltInTaxCalculator, createShop, DemoModel, exportStore, importStore, invoiceDocument, invoiceGaps, invoicesCsv, issueCreditNote, issueInvoice,
  listInvoices, orderDocuments, refundOrder, setInvoiceSettings, signUp,
} from "../src";
import { makeFixture } from "../evals/fixture";

const settings = { legalName: "Glow Lamps LLC", address: "500 Congress Ave\nAustin, TX 78701", prefix: "GL-", nextNumber: 1, footer: "Thank you for shopping with us." };

describe("invoices", () => {
  it("checks the settings, and numbers only go up", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    expect(invoiceGaps(shop)).toHaveLength(2);
    await expect(setInvoiceSettings(f.db, shop.id, { ...settings, prefix: "GL 2026" })).rejects.toThrow("letters, numbers");
    await expect(setInvoiceSettings(f.db, shop.id, { ...settings, nextNumber: 0 })).rejects.toThrow("whole number");
    await setInvoiceSettings(f.db, shop.id, { ...settings, nextNumber: 100 });
    expect(invoiceGaps(await f.shop())).toEqual([]);
    await expect(setInvoiceSettings(f.db, shop.id, { ...settings, nextNumber: 99 })).rejects.toThrow("can't go below 100");
  });

  it("issues one numbered invoice per paid order, with the seller's details as they were", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setInvoiceSettings(f.db, shop.id, settings);
    await addTaxRegistration(f.db, new BuiltInTaxCalculator(), shop, { jurisdiction: "US-TX", registrationNumber: "32012345678" });
    const first = await f.waitingOrder();
    const second = await f.waitingOrder();
    const [a] = await orderDocuments(f.db, first.id);
    const [b] = await orderDocuments(f.db, second.id);
    expect([a!.number, b!.number]).toEqual(["GL-0001", "GL-0002"]);
    // Asking again, or at the same time, never takes another number.
    const again = await Promise.all([issueInvoice(f.db, first.id), issueInvoice(f.db, first.id)]);
    expect(again.map((d) => d!.id)).toEqual([a!.id, a!.id]);

    // The confirmation email links to it.
    const mail = f.mailer.sent.find((m) => m.to === first.email && m.subject.includes("confirmed"))!;
    expect(mail.text).toContain(`Your invoice GL-0001: https://${shop.handle}.example/orders/${first.paymentIntentId}/invoice`);

    // Changing the details later leaves the issued invoice as it was.
    await setInvoiceSettings(f.db, shop.id, { ...settings, legalName: "New Name Ltd", nextNumber: 3 });
    const doc = await invoiceDocument(f.db, shop.id, a!.id);
    expect(doc).toMatchObject({
      title: "Invoice",
      number: "GL-0001",
      seller: { name: "Glow Lamps LLC", address: settings.address, taxNumbers: [{ label: "Sales tax permit (TX)", number: "32012345678" }], footer: settings.footer },
      buyer: { name: "Ada Lovelace", email: first.email, address: ["1 Main St", "Austin, TX 78701", "US"] },
      currency: "USD",
      totalMinor: first.totalMinor,
      tax: [{ label: "Sales tax (TX) 6.25%", ratePct: 6.25, amountMinor: first.taxMinor }],
      credit: null,
    });
    expect(doc.lines.reduce((s, l) => s + l.totalMinor, 0)).toBe(first.subtotalMinor);
    expect(first.taxMinor).toBeGreaterThan(0);
    await expect(invoiceDocument(f.db, (await createShop(f.db, (await signUp(f.db, { email: "x@example.com", password: "correct horse" })).id, { name: "Other", country: "US" })).id, a!.id)).rejects.toThrow("not found");
  });

  it("gives every refund a credit note in the same series, and lists them for the accountant", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await setInvoiceSettings(f.db, shop.id, settings);
    const order = await f.waitingOrder();
    const half = Math.floor(order.totalMinor / 2);
    const { refund } = await refundOrder(f.ctx, shop.id, order.id, { amountMinor: half, reason: "Arrived scratched" });
    await refundOrder(f.ctx, shop.id, order.id, {});
    const docs = await orderDocuments(f.db, order.id);
    expect(docs.map((d) => [d.kind, d.number])).toEqual([["invoice", "GL-0001"], ["credit_note", "GL-0002"], ["credit_note", "GL-0003"]]);
    expect((await issueCreditNote(f.db, refund.id)).id).toBe(docs[1]!.id);

    const note = await invoiceDocument(f.db, shop.id, docs[1]!.id);
    expect(note).toMatchObject({ title: "Credit note", credit: { invoiceNumber: "GL-0001", amountMinor: half, reason: "Arrived scratched" } });
    const mail = f.mailer.sent.filter((m) => m.subject.startsWith("Refund for order"))[0]!;
    expect(mail.text).toContain(`Credit note GL-0002: https://${shop.handle}.example/orders/${order.paymentIntentId}/invoice?doc=${docs[1]!.id}`);

    const list = await listInvoices(f.db, shop.id);
    expect(list.map((r) => r.totalMinor)).toEqual([-(order.totalMinor - half), -half, order.totalMinor]);
    const csv = await invoicesCsv(f.db, shop, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) });
    expect(csv.split("\n")[0]).toBe("number,type,date,order,buyer,email,country,total (USD),of which tax");
    expect(csv).toContain(`GL-0002,credit note,`);
    expect(csv.trim().split("\n")).toHaveLength(4);
  });

  it("issues invoices for orders paid before invoices existed, and the details travel in the store file", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const order = await f.waitingOrder();
    await f.db.delete(schema.invoices).where(eq(schema.invoices.orderId, order.id));
    expect(await listInvoices(f.db, shop.id)).toEqual([]);
    const [doc] = await orderDocuments(f.db, order.id);
    // The default prefix, and the store name until a business name is set.
    expect(doc!.number).toMatch(/^INV-\d{4}$/);
    expect((await invoiceDocument(f.db, shop.id, doc!.id)).seller.name).toBe("Glow Lamps");

    await setInvoiceSettings(f.db, shop.id, { ...settings, nextNumber: 50 });
    const file = JSON.parse(JSON.stringify(await exportStore(f.db, shop.id)));
    expect(file.store.invoices).toEqual({ legal_name: "Glow Lamps LLC", address: settings.address, prefix: "GL-", footer: settings.footer });
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, file);
    const copied = (await f.db.query.shops.findFirst({ where: eq(schema.shops.id, copy.id) }))!;
    expect(copied).toMatchObject({ invoiceLegalName: "Glow Lamps LLC", invoicePrefix: "GL-", invoiceNextNumber: 1 });
  });
});
