const commissionPercent = 10;

export const commissionKobo = (fareKobo: number) =>
  Math.floor(fareKobo * commissionPercent / 100);

export const unpaidCashCommission = (riderId: string) => `SELECT 1 FROM cash_commissions c
  WHERE c.rider_id=${riderId} AND c.paid_at IS NULL AND c.due_at<=clock_timestamp()`;
