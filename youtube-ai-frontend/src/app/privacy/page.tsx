import type { Metadata } from 'next'
import { LegalPage, Section, Bullets } from '@/components/legal/legal-page'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: `Privacy Policy — ${LEGAL.product}` }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {LEGAL.product} ({LEGAL.site}) is a private content-management tool operated by {LEGAL.company}. It helps the
        channel owner plan, write, schedule and analyze videos, reels and posts on social platforms the owner has
        connected. This policy explains what data the app accesses and what it does with it.
      </p>

      <Section title="Purpose of the app">
        <p>
          {LEGAL.product} exists for one purpose: to let {LEGAL.company} manage its own channels and social accounts from
          one place. It reads the account’s own videos, posts and performance numbers, helps prepare content, and publishes
          content that the account owner has approved. It is a private tool built for this client. It is not offered to the
          public, it does not collect data from other people’s accounts, and it runs in a controlled, invitation-only
          (development/test) mode on the social platforms.
        </p>
      </Section>

      <Section title="Who this applies to">
        <p>
          The app is used by {LEGAL.company} for its own channels and accounts. A social account is connected only when its
          owner signs in on the platform’s own login page and approves the access requested. We never see or store the
          owner’s password for Google, Instagram, Facebook or TikTok.
        </p>
      </Section>

      <Section title="Data we access">
        <p>Only what the owner approves on the platform's consent screen:</p>
        <Bullets
          items={[
            'YouTube / Google: channel details, video list, video and channel analytics, comments, and permission to upload or update videos.',
            'Instagram: professional account profile, media list, insights (views, reach, followers) and permission to publish posts and reels.',
            'Facebook Pages: Page name, post list, Page insights and comments, and permission to publish posts and videos on the Page.',
            'TikTok: profile information, public video list and statistics, and permission to publish videos to the connected account.',
            'Basic sign-in data: name, email address and profile picture of the person who logs in.',
          ]}
        />
      </Section>

      <Section title="How we use it">
        <Bullets
          items={[
            'Show the owner their videos, posts and performance in one dashboard.',
            'Publish or schedule content that the owner has created or approved.',
            'Reply to comments and prepare scripts, titles and descriptions from the owner’s own content and performance.',
            'Keep the connection working (for example, refreshing access tokens).',
          ]}
        />
        <p>
          We do not sell this data, do not use it for advertising, and do not use it to build profiles of other people.
          Data obtained from Google, Meta and TikTok is used only to provide the features above.
        </p>
      </Section>

      <Section title="Services that process data for us">
        <p>
          To run the app we use hosting and AI providers. Text from the owner’s own videos and comments may be sent to an AI
          provider such as OpenAI to generate scripts, titles and replies. Data is shared with these providers only to
          deliver the feature the owner asked for.
        </p>
      </Section>

      <Section title="Storage and retention">
        <p>
          Account connections (access tokens) and cached video and analytics data are stored on our own servers and
          are accessible only to the operator of the app. We keep them while the account is connected. When an account is
          disconnected or a deletion request is made, we delete its tokens and stored data as described on our{' '}
          <a className="text-indigo-500 hover:underline" href="/data-deletion">Data Deletion</a> page.
        </p>
      </Section>

      <Section title="Data received from Meta (Instagram and Facebook)">
        <Bullets
          items={[
            'We request only the permissions needed for the features above (reading the account’s profile, media and insights, and publishing posts and reels).',
            'Data from Meta is used only for the connected account’s owner, only inside this app.',
            'It is not sold, not shared with data brokers or advertisers, and not used for advertising or for purposes unrelated to the app.',
            'We delete it on request or when the account is disconnected, as described on the Data Deletion page.',
          ]}
        />
      </Section>

      <Section title="Security">
        <Bullets
          items={[
            'All traffic to the app is encrypted with HTTPS.',
            'Access tokens and account data are kept on our own servers, not in the browser, and only the operator of the app can reach them.',
            'Server access is restricted to authorized administrators using key-based login.',
            'We request the minimum permissions each feature needs and do not read or store account passwords.',
            'No method of storage or transmission is perfectly secure, so if we ever learn of a breach that affects connected accounts we will tell the account owner and the platform concerned.',
          ]}
        />
      </Section>

      <Section title="Children">
        <p>The app is a business tool and is not intended for anyone under 18. We do not knowingly collect data from children.</p>
      </Section>

      <Section title="Your choices and rights">
        <Bullets
          items={[
            'Disconnect any account at any time inside the app.',
            'Remove the app’s access from the platform itself: Google Account → Security → Third-party access; Facebook / Instagram → Settings → Apps and Websites; TikTok → Settings → Security and permissions → Apps and services.',
            'Ask us to delete the data we hold. See the Data Deletion page.',
          ]}
        />
      </Section>

      <Section title="Google API Services">
        <p>
          The use and transfer of information received from Google APIs to any other app will adhere to the Google API
          Services User Data Policy, including the Limited Use requirements.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          We may update this policy and will change the date above when we do. Questions: {LEGAL.contactEmail}.
        </p>
      </Section>
    </LegalPage>
  )
}
