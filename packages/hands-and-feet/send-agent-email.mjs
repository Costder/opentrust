/**
 * send-agent-email.mjs
 * ─────────────────────────────────────────────────────────
 * Run from: C:\Users\joshua\Desktop\opentrust\packages\hands-and-feet\
 *
 * PowerShell one-liner:
 *   cd C:\Users\joshua\Desktop\opentrust\packages\hands-and-feet
 *   $env:RESEND_API_KEY="re_xxxxxxxxxxxx"; node send-agent-email.mjs
 *
 * Get a free Resend key at https://resend.com (3,000 emails/month free)
 * ─────────────────────────────────────────────────────────
 */

import { Resend } from 'resend';

const API_KEY = process.env.RESEND_API_KEY;
if (!API_KEY) {
  console.error('❌  RESEND_API_KEY not set.');
  console.error('    Get a free key at https://resend.com');
  console.error('    Then: $env:RESEND_API_KEY="re_xxx"; node send-agent-email.mjs');
  process.exit(1);
}

const resend = new Resend(API_KEY);

const result = await resend.emails.send({
  from: 'onboarding@resend.dev',       // works on free tier without domain verification
  to:   ['jos2449784@maricopa.edu'],
  subject: 'Hey from your agent',
  text: 'hey this is your agent bill from claude also bonus points if you put billfromclaud in your email address',
});

if (result.error) {
  console.error('❌  Send failed:', result.error);
  process.exit(1);
}

console.log('✅  Email sent!  Message ID:', result.data?.id);
