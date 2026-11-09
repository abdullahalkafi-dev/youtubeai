import type { Metadata } from 'next'
import { LegalPage, Section, Bullets } from '@/components/legal/legal-page'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: `Data Deletion — ${LEGAL.product}` }

export default function DataDeletionPage() {
  return (
    <LegalPage title="Data Deletion Instructions">
      <p>
        You can remove the data {LEGAL.product} holds about your connected Instagram, Facebook, TikTok or YouTube
        account at any time. Pick whichever option is easiest.
      </p>

      <Section title="Option 1: Remove the app from the platform">
        <p>This immediately stops the app from reading or posting to your account:</p>
        <Bullets
          items={[
            'Facebook: Settings & privacy → Settings → Apps and Websites (or Business Integrations) → select the app → Remove.',
            'Instagram: Settings → Website permissions → Apps and websites → select the app → Remove.',
            'TikTok: Settings and privacy → Security and permissions → Apps and services → select the app → Remove.',
            'Google / YouTube: myaccount.google.com → Security → Third-party apps with account access → select the app → Remove access.',
          ]}
        />
      </Section>

      <Section title="Option 2: Ask us to delete the stored data">
        <p>
          Email <strong>{LEGAL.contactEmail}</strong> from the address you used with the app, with the subject “Delete my
          data” and the name of the account (Instagram username, Facebook Page, TikTok handle or YouTube channel). We will
          delete the stored access tokens, cached videos, posts and analytics for that account and confirm by email.
        </p>
      </Section>

      <Section title="What happens next">
        <Bullets
          items={[
            'Access tokens are deleted, so the app can no longer reach your account.',
            'Cached videos, posts, comments and analytics for that account are deleted from our database.',
            'Content already published on the platforms is not removed by this. Delete that on the platform itself.',
            'Backups and logs are cleared in the normal rotation cycle.',
          ]}
        />
      </Section>

      <p>
        See also the <a className="text-indigo-500 hover:underline" href="/privacy">Privacy Policy</a>.
      </p>
    </LegalPage>
  )
}
