import type { Metadata } from 'next'
import { LegalPage, Section, Bullets } from '@/components/legal/legal-page'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: `Terms of Service — ${LEGAL.product}` }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms cover the use of {LEGAL.product} ({LEGAL.site}), operated by {LEGAL.company}. By signing in or
        connecting an account you agree to them.
      </p>

      <Section title="The service">
        <p>
          {LEGAL.product} is a private tool for managing video and social content: viewing channel and account data,
          generating scripts and metadata, and publishing or scheduling posts to the accounts that the user connects.
        </p>
      </Section>

      <Section title="Accounts and access">
        <Bullets
          items={[
            'You may only connect accounts you own or are authorized to manage.',
            'Connecting an account grants the app only the permissions you approved on the platform’s consent screen. You can remove that access at any time.',
            'Keep your login details secure. You are responsible for activity under your login.',
          ]}
        />
      </Section>

      <Section title="Your content">
        <p>
          You keep ownership of everything you upload, write or publish through the app. You are responsible for that
          content and for complying with the rules of each platform you publish to (YouTube, Instagram, Facebook,
          TikTok and others). Content generated with AI assistance should be reviewed by you before it is published.
        </p>
      </Section>

      <Section title="Acceptable use">
        <Bullets
          items={[
            'No unlawful, abusive, deceptive or infringing content.',
            'No attempts to bypass platform limits, scrape other people’s data or misuse the connected accounts.',
            'No attempts to disrupt or gain unauthorized access to the service.',
          ]}
        />
      </Section>

      <Section title="Third-party platforms">
        <p>
          The service depends on APIs from Google, Meta and TikTok. Their availability, limits and rules can change, and
          we are not responsible for changes or outages on those platforms.
        </p>
      </Section>

      <Section title="No warranty and limitation of liability">
        <p>
          The service is provided “as is” without warranties. To the extent permitted by law, {LEGAL.company} is not liable
          for indirect or consequential losses, lost views or revenue, or content that a platform removes or restricts.
        </p>
      </Section>

      <Section title="Ending use">
        <p>
          You can stop using the service and disconnect your accounts at any time. We may suspend access if these terms are
          broken or the platforms’ rules require it. Data handling after disconnecting is described in the{' '}
          <a className="text-indigo-500 hover:underline" href="/privacy">Privacy Policy</a> and on the{' '}
          <a className="text-indigo-500 hover:underline" href="/data-deletion">Data Deletion</a> page.
        </p>
      </Section>

      <Section title="Contact">
        <p>Questions about these terms: {LEGAL.contactEmail}.</p>
      </Section>
    </LegalPage>
  )
}
