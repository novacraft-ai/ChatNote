import { useState, useEffect } from 'react'
import './PrivacyConsentModal.css';

type View = 'consent' | 'privacy' | 'terms'

const PRIVACY_TEXT = `
ChatNote – Privacy Policy

Last Updated: Nov 29, 2025

ChatNote (“we”, “our”, “us”) is created and operated by a small independent team. By using our Web App you agree to the practices below.

1. Information We Collect

We only collect the data necessary to operate and improve the product:
- Account details: email, username
- Usage data and interactions: features used, timestamps, basic telemetry
- Device & browser info: operating system, browser version (for compatibility)

2. How We Use Your Data

We use your data only to:
- Provide and maintain ChatNote features
- Improve performance and user experience
- Secure the service and prevent abuse

We do not sell your personal data to third parties.

3. Data Storage & Security

We store data on secure infrastructure and apply industry-standard protections (encryption in transit and at rest where supported). No online system can guarantee absolute security, but we take reasonable steps to protect your information.

4. Cookies & Analytics

We may use cookies and trusted analytics partners to understand usage patterns, diagnose issues, and improve the app. These tools collect aggregated usage data and do not include content you upload.

5. Your Rights

You can request access to, correction of, export of, or deletion of your data. To make a request, contact us at the email below; we will respond to legitimate requests as required by applicable law.

6. Contact

Email: nova.ai.craft@gmail.com
`

const TERMS_TEXT = `
ChatNote – Terms of Use

By using ChatNote you agree to the terms set out below.

1. License to Use

- We grant you a limited, non-exclusive, non-transferable license to use ChatNote for personal, non-commercial purposes.
- You may not claim ownership of the platform or redistribute the software.

2. Acceptable Use

You agree not to:
- Use ChatNote for illegal, harmful, or abusive activities
- Reverse-engineer, copy, or modify the service
- Upload content that is illegal, harmful, or infringes others' rights

We reserve the right to suspend or terminate accounts that violate these rules.

3. User Content

- You retain ownership of the content you create or upload.
- By using the service you grant ChatNote permission to store and process that content as necessary to provide the service.

4. Service Availability

ChatNote may modify, update, or discontinue features at any time. We do our best to maintain availability but are not liable for outages or data loss.

5. Limitation of Liability

ChatNote is provided "as is" and we limit our liability to the extent permitted by law. We are not responsible for indirect or consequential damages.

6. Changes to Terms

We may update these terms. Continued use after changes indicates acceptance of the updated terms.

7. Contact

Email: nova.ai.craft@gmail.com
`

const PrivacyConsentModal = ({
  onAgree,
  onDisagree,
  isVisible,
}: {
  onAgree: () => void;
  onDisagree: () => void;
  isVisible: boolean;
}) => {
  const [view, setView] = useState<View>('consent')

  useEffect(() => {
    if (isVisible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isVisible]);

  const openPrivacy = () => setView('privacy')
  const openTerms = () => setView('terms')
  const goBack = () => setView('consent')

  const renderBody = (body: string) => {
    // Split into blocks by empty line, then render heuristically
    const blocks = body.split('\n\n').map(b => b.trim()).filter(Boolean)

    return blocks.map((block, idx) => {
        // If block starts with a numbered section like "1. Information..." -> heading
        if (/^\d+\.\s+/.test(block)) {
          return <h4 key={idx}>{block}</h4>
        }

        // Split into lines and normalize them by trimming and removing leading
        // list markers (dash, bullet, asterisk) so we don't render duplicate
        // bullets (e.g. "- Item" becomes "Item" inside an <li>).
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
        const normalize = (line: string) => line.replace(/^[-*•]\s*/, '').trim()

        // If the block contains multiple lines, treat as a list
        if (lines.length > 1) {
          return (
            <ul key={idx}>
              {lines.map((line, i) => (
                <li key={i}>{normalize(line)}</li>
              ))}
            </ul>
          )
        }

        // If a single-line block begins with a list marker, render it as a single-item list
        if (/^[-*•]\s+/.test(block)) {
          return (
            <ul key={idx}>
              <li>{normalize(block)}</li>
            </ul>
          )
        }

        // Default paragraph
        return <p key={idx}>{block}</p>
    })
  }

  const renderDetail = (title: string, body: string) => (
    <div className="detail-content">
      <div className="detail-header">
        <button className="back-button" onClick={goBack} aria-label="Back to consent">← Back</button>
        <h3 className="detail-title">{title}</h3>
      </div>
      <div className="detail-body" tabIndex={0}>
        {renderBody(body)}
      </div>
      {/* NOTE: Intentionally do not include Agree button in detail view. User must use Back then Agree on main consent. */}
    </div>
  )

  if (!isVisible) return null;

  return (
    <div className="privacy-consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="modal-content" tabIndex={-1}>
        {view === 'consent' && (
          <>
            <h2 id="consent-title">ChatNote – Privacy Consent</h2>

            <div className="modal-body">
              <p>To continue, please agree to the following:</p>
              <ul>
                <li>We collect essential data to create your account and improve app features.</li>
                <li>Your data is protected and never sold to third parties.</li>
                <li>We may use trusted partners for analytics and secure storage.</li>
                <li>You can request to access or delete your data at any time.</li>
              </ul>

              <p className="modal-note">By tapping “Agree”, you confirm that you have read and consent to ChatNote’s data practices.</p>
            </div>

            <div className="modal-footer">
              <div className="modal-actions">
                <button type="button" onClick={onAgree} className="btn agree-button">Agree</button>
                <button type="button" onClick={onDisagree} className="btn disagree-button">Disagree</button>
              </div>

              <div className="modal-links">
                <button className="link-button" onClick={openPrivacy} aria-label="Open Privacy Policy">Privacy Policy</button>
                <button className="link-button" onClick={openTerms} aria-label="Open Terms of Use">Terms of Use</button>
              </div>
            </div>
          </>
        )}

        {view === 'privacy' && renderDetail('ChatNote – Privacy Policy', PRIVACY_TEXT)}
        {view === 'terms' && renderDetail('ChatNote – Terms of Use', TERMS_TEXT)}
      </div>
    </div>
  )
}

export default PrivacyConsentModal;