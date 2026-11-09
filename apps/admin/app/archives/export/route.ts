import { apiRequest } from '../../admin-auth';

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new Response('Invalid request origin', { status: 403 });
  }
  const data = await request.formData().catch(() => null);
  const accountId = data?.get('accountId');
  if (typeof accountId !== 'string' || !/^[0-9a-f-]{36}$/i.test(accountId)) {
    return new Response('Invalid account ID', { status: 400 });
  }
  const result = await apiRequest('/admin/archives/' + accountId + '/export', 'POST').catch(() => null);
  if (result?.status !== 200) {
    return new Response(result?.data.error ?? 'Archive export unavailable', {
      status: result?.status ?? 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return Response.json(result.data.archive, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="account-${accountId}.json"`,
    },
  });
}
