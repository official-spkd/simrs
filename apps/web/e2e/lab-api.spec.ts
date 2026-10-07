import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { DEVICE_PRINCIPAL_DAYS, newId } from '@simrs/shared';
import { encryptField, hashToken, randomToken } from '@simrs/shared/node';
import { type Account, createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { e2eFieldKeys } from './support/field-keys';
import { mockLis } from './support/mock';

/**
 * Fase 4 §4.2 · Laboratorium mode api ujung ke ujung: order CPOE Kalium → analis lab menerima order (label barcode) dan
 * spesimen → mock analyzer (4.1b) mengirim ORU^R01 bertanda tangan → worker mencatat hasil awal bersumber analyzer →
 * validasi teknis analis → validasi klinis dokter lab (rilis, TTE). Mengubah kredensial mock (keadaan bersama): hanya
 * proyek desktop.
 */

const tenantId = TENANTS.RSFA;

/** Penugasan akun uji dipindah ke unit Laboratorium RS (lingkup `unit` = order ke unit lab). */
async function assignToLab(account: Account): Promise<string> {
  return inTenant(tenantId, async (tx) => {
    const lab = await tx.unit.findFirstOrThrow({ where: { code: 'LAB' }, select: { id: true } });
    await tx.staffAssignment.updateMany({ where: { userId: account.id }, data: { unitId: lab.id } });
    return lab.id;
  });
}

/** Analyzer terdaftar di unit lab (token `dv1` + kunci HMAC terenkripsi), dipasang ke mock. */
async function registerAnalyzer(labUnitId: string): Promise<void> {
  const id = newId();
  const secret = randomToken();
  const hmacKey = randomBytes(32).toString('base64url');
  const now = new Date();
  await inTenant(tenantId, (tx) =>
    tx.registeredDevice.create({
      data: {
        id,
        tenantId,
        kind: 'lab_analyzer',
        name: `Analyzer E2E ${id.slice(-6)}`,
        unitId: labUnitId,
        tokenHash: hashToken(secret),
        createdAt: now,
        expiresAt: new Date(now.getTime() + DEVICE_PRINCIPAL_DAYS * 86_400_000),
        enrolExpiresAt: new Date(now.getTime() + 15 * 60_000),
        enrolledAt: now,
        hmacKeyEnc: encryptField(hmacKey, { ring: e2eFieldKeys().enc, tenantId, purpose: 'device_hmac' }),
      },
    }),
  );
  await mockLis.configure(`dv1.${tenantId}.${id}.${secret}`, hmacKey);
}

/** Kunjungan rawat inap + kiriman CPOE berisi order "Kalium" untuk unit lab. */
async function orderKalium(patientName: string, dpjp: Account) {
  const p = await createPatient('RSFA', { name: patientName, sex: 'male', birthDate: '1968-03-03' });
  return inTenant(tenantId, async (tx) => {
    const ward = await tx.unit.findFirstOrThrow({ where: { code: 'MELATI' }, select: { id: true } });
    const encounterId = newId();
    await tx.encounter.create({
      data: {
        id: encounterId,
        tenantId,
        number: `RI-E2E-${newId().slice(-8)}`,
        patientId: p.id,
        encounterClass: 'IMP',
        status: 'in_progress',
        unitId: ward.id,
        plannedAt: new Date(),
      },
    });
    const groupId = newId();
    await tx.orderGroup.create({
      data: {
        id: groupId,
        tenantId,
        encounterId,
        patientId: p.id,
        idempotencyKey: newId(),
        requestHash: 'c'.repeat(64),
        orderedBy: dpjp.id,
        orderedRole: 'dokter',
      },
    });
    const kalium = await tx.orderable.findFirstOrThrow({ where: { kind: 'lab', name: 'Kalium' } });
    await tx.serviceRequest.create({
      data: {
        id: newId(),
        tenantId,
        orderGroupId: groupId,
        encounterId,
        patientId: p.id,
        orderableId: kalium.id,
        name: kalium.name,
        codeSystem: kalium.codeSystem,
        code: kalium.code,
        priority: 'cito',
      },
    });
  });
}

test.describe('Laboratorium mode api (4.2)', () => {
  test.afterEach(async () => {
    await mockLis.reset();
  });

  test('terima order → spesimen → hasil analyzer → validasi teknis → rilis dokter lab', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'kredensial mock analyzer = keadaan bersama');
    test.setTimeout(150_000);
    const name = `Tn. Lab E2E ${newId().slice(-5).toUpperCase()}`;
    const analis = await createAccount({ roles: ['analis_lab'], displayName: 'Fitri Handayani' });
    const dokterLab = await createAccount({ roles: ['dokter'], displayName: 'dr. Ratna Sari, Sp.PK' });
    const dpjp = await createAccount({ roles: ['dokter'], displayName: 'dr. Andini Prameswari' });
    const labUnitId = await assignToLab(analis);
    await assignToLab(dokterLab);
    await orderKalium(name, dpjp);
    await registerAnalyzer(labUnitId);

    await loginAs(page, analis, '/penunjang/lab');
    await expect(page.getByRole('heading', { name: 'Laboratorium', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: 'Terima order & buat label' }).click();
    await expect(page.getByText(/Order diterima: L\d{10}, 1 label spesimen/)).toBeVisible();
    await expect(page).toHaveURL(/order=/);
    const specimens = page.getByRole('table', { name: 'Spesimen' });
    const barcode = ((await specimens.getByRole('cell').first().textContent()) ?? '').trim();
    expect(barcode).toMatch(/^L\d{10}-01$/);
    await specimens.getByRole('button', { name: 'Terima' }).click();
    await expect(specimens.getByText('Diterima lab')).toBeVisible();

    // Analyzer mengirim hasil elektrolit (Kalium 4,2) bertanda tangan; worker memprosesnya async.
    const sent = await mockLis.send(barcode, 'elektrolit');
    expect(sent.deliveries.map((d) => [d.status, d.ack])).toEqual([[200, 'AA']]);
    const results = page.getByRole('table', { name: 'Hasil' });
    await expect
      .poll(
        async () => {
          await page.reload();
          return (await results.textContent()) ?? '';
        },
        { timeout: 45_000, intervals: [1000, 2000, 3000] },
      )
      .toContain('4,2 mmol/L');
    await expect(results.getByText(/Sementara · analyzer/)).toBeVisible();

    await page.getByRole('button', { name: 'Validasi teknis' }).click();
    await expect(page.getByText('Validasi teknis tercatat.')).toBeVisible();
    await expect(page.getByText('Tervalidasi teknis').first()).toBeVisible();
    const orderUrl = page.url();

    const docCtx = await browser.newContext();
    const doc = await docCtx.newPage();
    await loginAs(doc, dokterLab, new URL(orderUrl).pathname + new URL(orderUrl).search);
    await doc.getByRole('button', { name: 'Validasi klinis & rilis (TTE)' }).click();
    await expect(doc.getByText('Hasil dirilis; TTE diproses dan DPJP diberi tahu.')).toBeVisible();
    await expect(doc.getByRole('table', { name: 'Hasil' }).getByText(/Final · analyzer/)).toBeVisible();
    await docCtx.close();
  });
});
