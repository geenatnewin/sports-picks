import { NextRequest, NextResponse } from 'next/server';
import { listSlips, recordSlip, NewSlipInput } from '@/lib/slipHistory';

export async function GET() {
  const slips = await listSlips();
  return NextResponse.json({ slips });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as NewSlipInput;
  if (!Array.isArray(body.legs) || body.legs.length === 0) {
    return NextResponse.json({ error: 'legs required' }, { status: 400 });
  }
  const slip = await recordSlip(body);
  return NextResponse.json({ slip });
}
