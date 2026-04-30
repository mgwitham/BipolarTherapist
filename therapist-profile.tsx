'use client'

/**
 * Therapist Profile Page — Bipolar Therapy Hub
 * Next.js 14 App Router: save as app/therapists/[slug]/TherapistProfileClient.tsx
 *
 * Server wrapper: see therapist-page-server.tsx
 * The 'use client' directive means Next.js ignores the exported generateMetadata here.
 * Copy it into the server wrapper so metadata is rendered server-side (critical for SEO).
 *
 * tailwind.config.ts — add:
 *   extend: { fontFamily: { serif: ["'Lora'", "Georgia", "serif"] } }
 * layout.tsx <head> — add:
 *   <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet" />
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'

// ─── Data Model ──────────────────────────────────────────────────────────────

export interface TherapistProfile {
  id: string
  slug: string
  name: { first: string; last: string; display: string }
  credentials: string[]
  title: string
  license: {
    state: string
    type: string
    number: string
    verified?: boolean
  } | null
  location: {
    city: string
    state: string
    zip: string
    geo?: { lat: number; lng: number }
  }
  phone: string | null
  websiteUrl: string | null
  bio: string[]
  specialties: { label: string; isPrimary: boolean }[]
  approaches: string[]
  formats: ('telehealth' | 'in-person')[]
  insurance: string[]
  sessionFee: { min: number; max: number; slidingScale: boolean } | null
  languages: string[]
  acceptingPatients: boolean
  experience: number | null
  profileImage: string | null
  // Extended fields
  education?: { degree: string; institution: string; year?: number }[]
  listedSince?: string             // e.g. "2023"
  verifiedAt?: string              // ISO date of last license verification
  consultationFee?: 'free' | number | null
  availabilityNote?: string | null
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

export const KIMBERLY_LASKOWSKI: TherapistProfile = {
  id: 'kimberly-laskowski',
  slug: 'kimberly-laskowski',
  name: { first: 'Kimberly', last: 'Laskowski', display: 'Kimberly Laskowski' },
  credentials: ['MA', 'LMFT'],
  title: 'Licensed Marriage & Family Therapist',
  license: { state: 'CA', type: 'LMFT', number: '103247', verified: true },
  location: {
    city: 'San Francisco',
    state: 'CA',
    zip: '94117',
    geo: { lat: 37.769, lng: -122.447 },
  },
  phone: '(415) 555-0182',
  websiteUrl: 'https://kimberlylasmft.com',
  bio: [
    'I specialize in working with adults living with bipolar disorder, helping them build a stable foundation for their lives and closest relationships. My clients often come to me feeling exhausted by the cycling highs and lows — searching for a therapist who genuinely understands the condition, not just its textbook definition.',
    'My approach integrates Cognitive Behavioral Therapy (CBT), Psychoeducation, and mindfulness practices to help clients understand their mood cycles from the inside out. Together we work on building resilience, establishing sustainable routines, and navigating the relational and professional challenges that accompany a bipolar diagnosis.',
    'I believe a bipolar diagnosis does not define a person — it is one part of a complex, meaningful life. My goal is to help you and your family develop practical tools while cultivating a deeper, more compassionate understanding of yourself.',
  ],
  specialties: [
    { label: 'Bipolar Disorder', isPrimary: true },
    { label: 'Mood Disorders', isPrimary: true },
    { label: 'Anxiety', isPrimary: false },
    { label: 'Depression', isPrimary: false },
    { label: 'Life Transitions', isPrimary: false },
    { label: 'Relationship Issues', isPrimary: false },
    { label: 'Family Therapy', isPrimary: false },
  ],
  approaches: [
    'CBT',
    'Psychoeducation',
    'Mindfulness-Based Therapy',
    'DBT',
    'Motivational Interviewing',
  ],
  formats: ['telehealth', 'in-person'],
  insurance: ['Aetna', 'Cigna', 'United Healthcare', 'Anthem Blue Cross', 'Blue Shield of CA'],
  sessionFee: { min: 175, max: 225, slidingScale: true },
  languages: ['English', 'Spanish'],
  acceptingPatients: true,
  experience: 12,
  profileImage: null,
  education: [
    {
      degree: 'MA, Marriage & Family Therapy',
      institution: 'California State University, San Francisco',
      year: 2012,
    },
    {
      degree: 'BA, Psychology',
      institution: 'University of California, Davis',
      year: 2009,
    },
  ],
  listedSince: '2023',
  verifiedAt: '2025-03-15',
  consultationFee: 'free',
  availabilityNote: 'Typically responds within 1–2 business days.',
}

// ─── Analytics ───────────────────────────────────────────────────────────────

type AnalyticsProps = Record<string, unknown>

function analytics(event: string, props: AnalyticsProps): void {
  if (
    typeof window !== 'undefined' &&
    typeof (window as Window & { posthog?: (e: string, p: AnalyticsProps) => void })
      .posthog === 'function'
  ) {
    ;(
      window as Window & { posthog?: (e: string, p: AnalyticsProps) => void }
    ).posthog?.(event, props)
  } else {
    console.log('[BTH Analytics]', event, props)
  }
}

function useProfileAnalytics(therapistId: string) {
  useEffect(() => {
    const referrer = typeof document !== 'undefined' ? document.referrer : ''
    const params = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : '',
    )
    analytics('profile_view', {
      therapistId,
      referrer,
      matchContext: params.get('match') ?? null,
    })
  }, [therapistId])

  return {
    trackCallTapped: (source: 'hero' | 'sidebar' | 'mobile_bar') =>
      analytics('call_tapped', { therapistId, source }),
    trackWebsiteTapped: () => analytics('website_tapped', { therapistId }),
    trackSaveToggled: (saved: boolean) => analytics('save_toggled', { therapistId, saved }),
    trackScriptCopied: (type: 'email' | 'phone') =>
      analytics('script_copied', { therapistId, type }),
    trackFindSimilarClicked: () => analytics('find_similar_clicked', { therapistId }),
    trackReminderSet: () => analytics('reminder_set', { therapistId }),
    trackFaqExpanded: (question: string) =>
      analytics('faq_expanded', { therapistId, question }),
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastState {
  message: string
  visible: boolean
}

function useToast() {
  const [toast, setToast] = useState<ToastState>({ message: '', visible: false })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ message, visible: true })
    timerRef.current = setTimeout(
      () => setToast((s) => ({ ...s, visible: false })),
      3000,
    )
  }, [])

  return { toast, showToast }
}

function Toast({ message, visible }: ToastState) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed bottom-24 left-1/2 z-50 -translate-x-1/2',
        'rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg',
        'transition-all duration-300',
        visible
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0',
      ].join(' ')}
    >
      {message}
    </div>
  )
}

// ─── SiteHeader ───────────────────────────────────────────────────────────────

interface SiteHeaderProps {
  therapist: TherapistProfile
  saved: boolean
  onSaveToggle: (next: boolean) => void
  onShare: () => void
}

function SiteHeader({ therapist, saved, onSaveToggle, onShare }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="flex items-center gap-0.5 text-sm font-semibold text-gray-900"
        >
          <span>BipolarTherapy</span>
          <span className="text-purple-600">Hub</span>
        </Link>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSaveToggle(!saved)}
            aria-pressed={saved}
            aria-label={
              saved
                ? `Unsave ${therapist.name.display}`
                : `Save ${therapist.name.display}`
            }
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors hover:bg-gray-100"
          >
            <svg
              className={[
                'h-5 w-5 transition-colors',
                saved ? 'fill-purple-600 text-purple-600' : 'fill-none text-gray-500',
              ].join(' ')}
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={onShare}
            aria-label="Share this profile"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-colors hover:bg-gray-100"
          >
            <svg
              className="h-5 w-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>
  )
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  therapist,
  backLabel,
}: {
  therapist: TherapistProfile
  backLabel: string
}) {
  const handleBackClick = useCallback(() => {
    try {
      sessionStorage.setItem(
        `bth_scroll_${window.location.pathname}`,
        String(window.scrollY),
      )
    } catch {
      // sessionStorage may be unavailable
    }
  }, [])

  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-5xl px-4 pt-2 pb-0">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <li>
          <Link href="/" className="transition-colors hover:text-gray-700">
            Home
          </Link>
        </li>
        <li aria-hidden="true" className="text-gray-300">
          /
        </li>
        <li>
          <Link
            href="/directory"
            onClick={handleBackClick}
            className="transition-colors hover:text-gray-700"
          >
            {backLabel}
          </Link>
        </li>
        <li aria-hidden="true" className="text-gray-300">
          /
        </li>
        <li>
          <Link
            href={`/directory?state=${therapist.location.state}`}
            className="transition-colors hover:text-gray-700"
          >
            {therapist.location.state}
          </Link>
        </li>
        <li aria-hidden="true" className="text-gray-300">
          /
        </li>
        <li
          aria-current="page"
          className="max-w-[160px] truncate font-medium text-gray-700"
        >
          {therapist.name.display}
        </li>
      </ol>
    </nav>
  )
}

// ─── JumpNav ──────────────────────────────────────────────────────────────────

const JUMP_SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'specialties', label: 'Specialties' },
  { id: 'approach', label: 'Approach' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'contact', label: 'How to reach out' },
  { id: 'faq', label: 'FAQ' },
] as const

function JumpNav({ hasEducation }: { hasEducation: boolean }) {
  const [active, setActive] = useState<string>('')

  const navSections: { id: string; label: string }[] = hasEducation
    ? [
        JUMP_SECTIONS[0],
        { id: 'education', label: 'Education' },
        ...JUMP_SECTIONS.slice(1),
      ]
    : [...JUMP_SECTIONS]

  useEffect(() => {
    const els = navSections
      .map(({ id }) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)
    if (!els.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries.filter((e) => e.isIntersecting)
        if (entering.length > 0) {
          setActive(entering[entering.length - 1].target.id)
        }
      },
      { threshold: 0.25, rootMargin: '-10% 0px -55% 0px' },
    )
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
    // navSections is stable across renders (derived from prop only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEducation])

  const handleClick =
    (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault()
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActive(id)
    }

  return (
    <nav
      aria-label="Jump to section"
      className="mx-auto mb-2 hidden max-w-5xl overflow-x-auto px-4 md:block"
    >
      <div className="flex gap-0 border-b border-gray-100">
        {navSections.map(({ id, label }) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={handleClick(id)}
            className={[
              'flex min-h-[36px] items-center whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors',
              active === id
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  )
}

// ─── MatchBanner ──────────────────────────────────────────────────────────────

const MATCH_DISMISS_KEY = 'bth_match_banner_dismissed'

function MatchBanner({ matchParam }: { matchParam: string | null }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!matchParam) return
    try {
      if (!sessionStorage.getItem(MATCH_DISMISS_KEY)) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [matchParam])

  const dismiss = () => {
    try {
      sessionStorage.setItem(MATCH_DISMISS_KEY, '1')
    } catch {
      // best-effort
    }
    setVisible(false)
  }

  if (!visible || !matchParam) return null

  let decoded = matchParam
  try {
    decoded = decodeURIComponent(matchParam)
  } catch {
    // use raw value
  }

  return (
    <div className="border-b border-purple-100 bg-purple-50">
      <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5">
        <svg
          className="h-4 w-4 shrink-0 text-purple-600"
          fill="currentColor"
          viewBox="0 0 20 20"
          aria-hidden="true"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
        <p className="flex-1 text-xs text-purple-700">
          <span className="font-semibold">Matched based on your search:</span> {decoded}
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss match banner"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-purple-400 transition-colors hover:text-purple-700"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── TrustBar ─────────────────────────────────────────────────────────────────

function TrustBar({ therapist }: { therapist: TherapistProfile }) {
  const { license, verifiedAt, listedSince, consultationFee } = therapist

  const signals: string[] = []

  if (license?.verified !== false) {
    signals.push(`${license?.state ?? 'CA'} license verified`)
  }
  if (consultationFee === 'free') {
    signals.push('Free consultation offered')
  }
  if (listedSince) {
    signals.push(`Bipolar Therapy Hub member since ${listedSince}`)
  }
  if (verifiedAt) {
    const formatted = new Date(verifiedAt).toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    })
    signals.push(`Profile reviewed ${formatted}`)
  }

  if (signals.length === 0) return null

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-teal-100 bg-teal-50 px-4 py-2.5"
      aria-label="Trust and verification signals"
    >
      {signals.map((label) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-teal-700">
          <svg
            className="h-3.5 w-3.5 shrink-0 text-teal-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {label}
        </div>
      ))}
    </div>
  )
}

// ─── PostCallNudge ────────────────────────────────────────────────────────────

function PostCallNudge({
  therapistId,
  visible,
  onDismiss,
  onReminderSet,
}: {
  therapistId: string
  visible: boolean
  onDismiss: () => void
  onReminderSet: () => void
}) {
  if (!visible) return null

  const handleReminder = () => {
    const reminderAt = Date.now() + 48 * 60 * 60 * 1000
    try {
      const stored = JSON.parse(
        localStorage.getItem('bth_reminders') ?? '[]',
      ) as { therapistId: string; time: number }[]
      stored.push({ therapistId, time: reminderAt })
      localStorage.setItem('bth_reminders', JSON.stringify(stored))
    } catch {
      // localStorage may be unavailable
    }
    onReminderSet()
  }

  return (
    <div className="mt-3 rounded-xl border border-purple-100 bg-purple-50 p-3">
      <p className="mb-2 text-sm font-medium text-gray-800">Did you reach someone?</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleReminder}
          className="flex min-h-[44px] items-center rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-700"
        >
          Set a 48h follow-up reminder
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex min-h-[44px] items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

interface HeroProps {
  therapist: TherapistProfile
  heroCtaRef: React.RefObject<HTMLDivElement>
  onCallTapped: () => void
  onWebsiteTapped: () => void
  onReminderSet: () => void
}

function Hero({
  therapist,
  heroCtaRef,
  onCallTapped,
  onWebsiteTapped,
  onReminderSet,
}: HeroProps) {
  const [showPostCall, setShowPostCall] = useState(false)

  const initials = `${therapist.name.first[0]}${therapist.name.last[0]}`
  const credStr = therapist.credentials.join(', ')
  const feeLabel = therapist.sessionFee
    ? `$${therapist.sessionFee.min}–$${therapist.sessionFee.max}/session`
    : 'Fee not listed'

  const handleCallClick = () => {
    onCallTapped()
    setShowPostCall(true)
  }

  const PhoneIcon = () => (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
      />
    </svg>
  )

  const ExternalIcon = () => (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
      />
    </svg>
  )

  return (
    <section
      aria-labelledby="hero-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <div className="flex gap-4">
        {/* Avatar */}
        <div className="shrink-0">
          {therapist.profileImage ? (
            <Image
              src={therapist.profileImage}
              alt={`${therapist.name.display}, ${therapist.title}`}
              width={96}
              height={96}
              className="h-24 w-24 rounded-full object-cover"
              priority
            />
          ) : (
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-700 text-2xl font-semibold text-white"
              style={{ fontFamily: "'Lora', Georgia, serif" }}
              aria-hidden="true"
            >
              {initials}
            </div>
          )}
        </div>

        {/* Identity + CTAs */}
        <div className="flex min-w-0 flex-1 flex-col gap-0 md:flex-row md:gap-6">
          {/* Identity */}
          <div className="min-w-0 flex-1">
            <h1
              id="hero-heading"
              className="text-2xl font-semibold leading-tight text-gray-900"
              style={{ fontFamily: "'Lora', Georgia, serif" }}
            >
              {therapist.name.display}
              {credStr && (
                <span className="ml-2 text-base font-normal text-gray-400">{credStr}</span>
              )}
            </h1>
            <p className="mt-0.5 text-sm text-gray-600">{therapist.title}</p>
            <p className="mt-0.5 text-sm text-gray-400">
              {therapist.location.city}, {therapist.location.state}
              {therapist.experience !== null && (
                <> &middot; {therapist.experience} yrs experience</>
              )}
            </p>

            {/* Status badges */}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                <svg
                  className="h-3 w-3"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
                </svg>
                Bipolar specialist
              </span>

              {therapist.acceptingPatients && (
                <span
                  role="status"
                  className="inline-flex items-center gap-1 rounded-full border border-green-100 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700"
                >
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500"
                    aria-hidden="true"
                  />
                  Accepting new patients
                </span>
              )}

              {therapist.formats.includes('telehealth') && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  Telehealth
                </span>
              )}

              {therapist.consultationFee === 'free' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-purple-100 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700">
                  Free consultation
                </span>
              )}
            </div>
          </div>

          {/* Desktop CTAs */}
          <div
            ref={heroCtaRef}
            className="mt-4 hidden min-w-[180px] flex-col gap-2 md:mt-0 md:flex"
          >
            {therapist.phone && (
              <a
                href={`tel:${therapist.phone.replace(/\D/g, '')}`}
                onClick={handleCallClick}
                aria-label={`Call ${therapist.name.display}`}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
              >
                <PhoneIcon />
                Call to schedule
              </a>
            )}
            {therapist.websiteUrl && (
              <a
                href={therapist.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onWebsiteTapped}
                aria-label={`Visit ${therapist.name.display}'s website`}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <ExternalIcon />
                Visit website
              </a>
            )}
            {therapist.sessionFee && (
              <p className="mt-0.5 text-center text-xs text-gray-400">
                {feeLabel}
                {therapist.sessionFee.slidingScale && <> &middot; Sliding scale</>}
              </p>
            )}
            {therapist.availabilityNote && (
              <p className="text-center text-xs text-gray-400">{therapist.availabilityNote}</p>
            )}

            <PostCallNudge
              therapistId={therapist.id}
              visible={showPostCall}
              onDismiss={() => setShowPostCall(false)}
              onReminderSet={() => {
                setShowPostCall(false)
                onReminderSet()
              }}
            />
          </div>
        </div>
      </div>

      {/* Mobile CTAs */}
      <div className="mt-4 flex gap-2 md:hidden">
        {therapist.phone && (
          <a
            href={`tel:${therapist.phone.replace(/\D/g, '')}`}
            onClick={handleCallClick}
            aria-label={`Call ${therapist.name.display}`}
            className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            Call
          </a>
        )}
        {therapist.websiteUrl && (
          <a
            href={therapist.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onWebsiteTapped}
            aria-label={`Visit ${therapist.name.display}'s website`}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
            Website
          </a>
        )}
      </div>

      {/* Mobile PostCallNudge */}
      <PostCallNudge
        therapistId={therapist.id}
        visible={showPostCall}
        onDismiss={() => setShowPostCall(false)}
        onReminderSet={() => {
          setShowPostCall(false)
          onReminderSet()
        }}
      />
    </section>
  )
}

// ─── QuickStats ───────────────────────────────────────────────────────────────

function QuickStats({ therapist }: { therapist: TherapistProfile }) {
  const { sessionFee, formats, insurance, languages } = therapist

  const feeValue = sessionFee ? `$${sessionFee.min}–$${sessionFee.max}` : 'Not listed'
  const feeSub = sessionFee?.slidingScale ? 'Sliding scale available' : undefined

  const formatValue =
    formats.length === 2
      ? 'Telehealth + In-person'
      : formats[0] === 'telehealth'
        ? 'Telehealth'
        : 'In-person'

  const insSlice = insurance.slice(0, 2)
  const insOverflow = Math.max(0, insurance.length - 2)
  const insValue =
    insSlice.length > 0
      ? insSlice.join(', ') + (insOverflow > 0 ? ` +${insOverflow} more` : '')
      : 'Not listed'

  const langValue = languages.join(', ') || 'English'

  const stats: {
    label: string
    value: string
    sub?: string
    icon: React.ReactNode
  }[] = [
    {
      label: 'Session Fee',
      value: feeValue,
      sub: feeSub,
      icon: (
        <svg className="h-4 w-4 text-purple-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Format',
      value: formatValue,
      icon: (
        <svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.868v6.264a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: 'Insurance',
      value: insValue,
      icon: (
        <svg className="h-4 w-4 text-teal-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
    },
    {
      label: 'Languages',
      value: langValue,
      icon: (
        <svg className="h-4 w-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
        </svg>
      ),
    },
  ]

  return (
    <section
      aria-labelledby="quickstats-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm"
    >
      <h2 id="quickstats-heading" className="sr-only">
        Quick stats
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-gray-100 bg-gray-50 p-3"
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              {stat.icon}
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {stat.label}
              </p>
            </div>
            <p className="text-[15px] font-medium leading-snug text-gray-900">{stat.value}</p>
            {stat.sub && <p className="mt-0.5 text-[11px] text-gray-400">{stat.sub}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Bio ──────────────────────────────────────────────────────────────────────

function BioSection({ bio }: { bio: string[] }) {
  return (
    <section
      id="about"
      aria-labelledby="bio-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2
        id="bio-heading"
        className="mb-3 text-lg font-semibold text-gray-900"
        style={{ fontFamily: "'Lora', Georgia, serif" }}
      >
        About
      </h2>
      <div className="space-y-3">
        {bio.map((paragraph, i) => (
          <p key={i} className="text-sm leading-relaxed text-gray-700">
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  )
}

// ─── Education ────────────────────────────────────────────────────────────────

function EducationSection({
  education,
}: {
  education: TherapistProfile['education']
}) {
  if (!education?.length) return null

  return (
    <section
      id="education"
      aria-labelledby="education-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2
        id="education-heading"
        className="mb-3 text-lg font-semibold text-gray-900"
        style={{ fontFamily: "'Lora', Georgia, serif" }}
      >
        Education &amp; Training
      </h2>
      <ul className="space-y-3">
        {education.map((item, i) => (
          <li key={i} className="flex gap-3">
            <div
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-purple-400"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-gray-800">{item.degree}</p>
              <p className="text-xs text-gray-500">
                {item.institution}
                {item.year ? `, ${item.year}` : ''}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Focus Areas ──────────────────────────────────────────────────────────────

function FocusAreasSection({
  specialties,
}: {
  specialties: TherapistProfile['specialties']
}) {
  const sorted = [...specialties].sort(
    (a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0),
  )

  return (
    <section
      id="specialties"
      aria-labelledby="focus-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2
        id="focus-heading"
        className="mb-3 text-lg font-semibold text-gray-900"
        style={{ fontFamily: "'Lora', Georgia, serif" }}
      >
        Focus Areas
      </h2>
      <div className="flex flex-wrap gap-2">
        {sorted.map((s) => (
          <span
            key={s.label}
            className={[
              'rounded-full border px-3 py-1.5 text-sm font-medium',
              s.isPrimary
                ? 'border-purple-200 bg-purple-100 text-purple-700'
                : 'border-gray-200 bg-gray-100 text-gray-600',
            ].join(' ')}
          >
            {s.label}
          </span>
        ))}
      </div>
    </section>
  )
}

// ─── Therapeutic Approach ─────────────────────────────────────────────────────

function TherapeuticApproachSection({
  approaches,
  therapistFirstName,
}: {
  approaches: string[]
  therapistFirstName: string
}) {
  return (
    <section
      id="approach"
      aria-labelledby="approach-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2
        id="approach-heading"
        className="mb-3 text-lg font-semibold text-gray-900"
        style={{ fontFamily: "'Lora', Georgia, serif" }}
      >
        Therapeutic Approach
      </h2>
      <blockquote className="mb-4 border-l-4 border-blue-400 pl-4">
        <p
          className="text-sm italic leading-relaxed text-gray-600"
          style={{ fontFamily: "'Lora', Georgia, serif" }}
        >
          {therapistFirstName} uses evidence-based techniques tailored to the unique challenges
          of bipolar disorder, drawing from the following modalities:
        </p>
      </blockquote>
      <div className="flex flex-wrap gap-2">
        {approaches.map((a) => (
          <span
            key={a}
            className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700"
          >
            {a}
          </span>
        ))}
      </div>
    </section>
  )
}

// ─── Insurance ────────────────────────────────────────────────────────────────

function InsuranceSection({ insurance }: { insurance: string[] }) {
  return (
    <section
      id="insurance"
      aria-labelledby="insurance-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2
        id="insurance-heading"
        className="mb-3 text-lg font-semibold text-gray-900"
        style={{ fontFamily: "'Lora', Georgia, serif" }}
      >
        Insurance Accepted
      </h2>
      {insurance.length > 0 ? (
        <>
          <div className="mb-3 grid grid-cols-1 gap-y-2 sm:grid-cols-2">
            {insurance.map((plan) => (
              <div key={plan} className="flex items-center gap-2 text-sm text-gray-700">
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-teal-500"
                  aria-hidden="true"
                />
                {plan}
              </div>
            ))}
          </div>
          <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-400">
            Confirm coverage directly — benefits vary by plan and deductible.
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-500">
          Insurance information not listed. Contact this therapist to ask about accepted
          plans and out-of-pocket rates.
        </p>
      )}
    </section>
  )
}

// ─── ReachOutModule ───────────────────────────────────────────────────────────

function ReachOutModule({
  therapist,
  onScriptCopied,
  showToast,
}: {
  therapist: TherapistProfile
  onScriptCopied: (type: 'email' | 'phone') => void
  showToast: (msg: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'email' | 'phone'>('email')

  const emailScript = `Hi ${therapist.name.first},

My name is [Your name], and I'm reaching out because I'm looking for a therapist who specializes in bipolar disorder.

I came across your profile on Bipolar Therapy Hub and I'm interested in learning more about your availability and whether we might be a good fit.

A bit about me: [brief description — e.g. diagnosis history, what you're hoping to work on].

If you're accepting new patients, I'd love to schedule a brief consultation. Please let me know what works for you.

Thank you for your time.
[Your name]`

  const phoneScript = `Hi, my name is [Your name]. I'm calling because I found your listing on Bipolar Therapy Hub and I'm looking for a therapist who specializes in bipolar disorder. Are you currently accepting new patients? If so, I'd love to schedule a brief consultation call. My number is [your number]. Thank you!`

  const copyScript = async (text: string, type: 'email' | 'phone') => {
    try {
      await navigator.clipboard.writeText(text)
      onScriptCopied(type)
      showToast(`${type === 'email' ? 'Email' : 'Phone'} script copied`)
    } catch {
      // clipboard may be unavailable
    }
  }

  const CopyIcon = () => (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  )

  return (
    <section
      id="contact"
      aria-labelledby="reachout-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2
        id="reachout-heading"
        className="mb-1 text-lg font-semibold text-gray-900"
        style={{ fontFamily: "'Lora', Georgia, serif" }}
      >
        Not sure what to say?
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        Use one of these starter scripts to reach out.
      </p>

      <div
        role="tablist"
        aria-label="Contact scripts"
        className="mb-4 flex gap-1 border-b border-gray-100"
      >
        {(['email', 'phone'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`reachout-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={`reachout-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={[
              'min-h-[44px] border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors',
              activeTab === tab
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="reachout-panel-email"
        aria-labelledby="reachout-tab-email"
        hidden={activeTab !== 'email'}
      >
        <pre className="mb-3 whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 font-sans text-xs leading-relaxed text-gray-700">
          {emailScript}
        </pre>
        <button
          type="button"
          onClick={() => copyScript(emailScript, 'email')}
          className="flex min-h-[44px] items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
        >
          <CopyIcon />
          Copy email script
        </button>
      </div>

      <div
        role="tabpanel"
        id="reachout-panel-phone"
        aria-labelledby="reachout-tab-phone"
        hidden={activeTab !== 'phone'}
      >
        <pre className="mb-3 whitespace-pre-wrap rounded-xl border border-gray-100 bg-gray-50 p-4 font-sans text-xs leading-relaxed text-gray-700">
          {phoneScript}
        </pre>
        <button
          type="button"
          onClick={() => copyScript(phoneScript, 'phone')}
          className="flex min-h-[44px] items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700"
        >
          <CopyIcon />
          Copy phone script
        </button>
      </div>
    </section>
  )
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

export function buildFAQItems(
  therapist: TherapistProfile,
): { q: string; a: string }[] {
  const { name, acceptingPatients, insurance, sessionFee, formats, approaches, phone, websiteUrl, consultationFee } =
    therapist
  const { first: firstName, display: fullName } = name

  const contact = [
    phone ? `calling ${phone}` : null,
    websiteUrl ? `visiting their website` : null,
  ]
    .filter(Boolean)
    .join(' or ')

  return [
    {
      q: `Is ${fullName} currently accepting new patients?`,
      a: acceptingPatients
        ? `Yes, ${firstName} is currently accepting new patients. You can reach them by ${contact || 'the contact information on this page'} to schedule an initial appointment.`
        : `${firstName} is not currently accepting new patients. Use our directory to find similar bipolar disorder specialists near you.`,
    },
    {
      q: `What insurance does ${fullName} accept?`,
      a:
        insurance.length > 0
          ? `${firstName} accepts the following insurance plans: ${insurance.join(', ')}. Coverage for therapy varies by plan and deductible — confirm your specific benefits directly with ${firstName} or your insurance carrier before your first appointment.`
          : `Insurance information is not currently listed for ${firstName}. Contact them directly to ask about accepted plans and out-of-pocket rates.`,
    },
    {
      q: `How much does ${fullName} charge per session?`,
      a: sessionFee
        ? [
            `${firstName}'s session fee is $${sessionFee.min}–$${sessionFee.max}.`,
            sessionFee.slidingScale
              ? `A sliding scale fee is available for qualifying clients — ask about it when you reach out.`
              : null,
            consultationFee === 'free'
              ? `A free initial consultation is offered so you can discuss your needs before committing to ongoing sessions.`
              : null,
          ]
            .filter(Boolean)
            .join(' ')
        : `Session fee information is not listed. Contact ${firstName} directly to ask about rates and payment options.`,
    },
    {
      q: `Does ${fullName} offer online therapy or telehealth?`,
      a:
        formats.includes('telehealth') && formats.includes('in-person')
          ? `Yes, ${firstName} offers both telehealth (secure video sessions) and in-person appointments at their ${therapist.location.city} office. You can discuss your preference when scheduling.`
          : formats.includes('telehealth')
            ? `Yes, ${firstName} offers telehealth sessions — you can attend therapy from home via secure video, making it easier to fit appointments into your schedule.`
            : `${firstName} currently offers in-person sessions in ${therapist.location.city}, ${therapist.location.state}.`,
    },
    {
      q: `What therapy approaches does ${fullName} use for bipolar disorder?`,
      a: `${firstName} draws on ${approaches.slice(0, -1).join(', ')}${approaches.length > 1 ? `, and ${approaches[approaches.length - 1]}` : approaches[0]}. These evidence-based modalities are recognized as effective for managing bipolar disorder, improving mood stability, and building resilience in everyday life.`,
    },
    {
      q: `How do I schedule an appointment with ${fullName}?`,
      a: [
        `You can reach ${firstName} by ${contact || 'the contact details on this page'}.`,
        consultationFee === 'free'
          ? `A free initial consultation is available — this is a good opportunity to share your diagnosis history, ask questions, and see whether you're a good fit before committing to ongoing sessions.`
          : `Many therapists offer a brief phone call before the first session so both parties can assess fit.`,
        `When you reach out, mention that you found their profile on Bipolar Therapy Hub and describe what you're hoping to work on.`,
      ].join(' '),
    },
  ]
}

interface FAQSectionProps {
  therapist: TherapistProfile
  onFaqExpanded: (q: string) => void
}

function FAQSection({ therapist, onFaqExpanded }: FAQSectionProps) {
  const items = buildFAQItems(therapist)
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const toggle = (i: number) => {
    if (openIndex !== i) onFaqExpanded(items[i].q)
    setOpenIndex(openIndex === i ? null : i)
  }

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="mb-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <h2
        id="faq-heading"
        className="mb-1 text-lg font-semibold text-gray-900"
        style={{ fontFamily: "'Lora', Georgia, serif" }}
      >
        Frequently Asked Questions
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        Common questions about {therapist.name.display}
      </p>

      <div className="divide-y divide-gray-100">
        {items.map((item, i) => (
          <div key={i}>
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-expanded={openIndex === i}
              aria-controls={`faq-answer-${i}`}
              id={`faq-question-${i}`}
              className="flex min-h-[44px] w-full items-start justify-between gap-3 py-3.5 text-left"
            >
              <span className="text-sm font-medium text-gray-800">{item.q}</span>
              <svg
                className={[
                  'mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200',
                  openIndex === i ? 'rotate-180' : '',
                ].join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div
              id={`faq-answer-${i}`}
              role="region"
              aria-labelledby={`faq-question-${i}`}
              hidden={openIndex !== i}
            >
              <p className="pb-4 text-sm leading-relaxed text-gray-600">{item.a}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  therapist,
  onCallTapped,
  onFindSimilarClicked,
}: {
  therapist: TherapistProfile
  onCallTapped: () => void
  onFindSimilarClicked: () => void
}) {
  const bbsUrl = therapist.license
    ? `https://search.dca.ca.gov/details/8607/${therapist.license.number}`
    : null

  return (
    <aside
      className="hidden w-72 shrink-0 flex-col gap-4 md:flex"
      aria-label="Provider contact and verification"
    >
      {/* Contact card */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Contact</h3>

        {therapist.phone && (
          <a
            href={`tel:${therapist.phone.replace(/\D/g, '')}`}
            onClick={onCallTapped}
            aria-label={`Call ${therapist.name.display}`}
            className="mb-2 flex items-center gap-2 text-sm text-gray-700 transition-colors hover:text-purple-600"
          >
            <svg
              className="h-4 w-4 shrink-0 text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            {therapist.phone}
          </a>
        )}

        <p className="mb-3 flex items-start gap-2 text-sm text-gray-600">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          {therapist.location.city}, {therapist.location.state} {therapist.location.zip}
        </p>

        {therapist.acceptingPatients && (
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span
              className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-500"
              aria-hidden="true"
            />
            <span className="font-medium text-green-700">Accepting new patients</span>
          </div>
        )}

        {therapist.availabilityNote && (
          <p className="mb-3 text-xs text-gray-400">{therapist.availabilityNote}</p>
        )}

        {therapist.phone && (
          <a
            href={`tel:${therapist.phone.replace(/\D/g, '')}`}
            onClick={onCallTapped}
            aria-label={`Call ${therapist.name.display} to schedule`}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            Call to schedule
          </a>
        )}
      </div>

      {/* License badge */}
      {therapist.license && (
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">License</h3>
          <p className="mb-0.5 text-xs text-gray-500">
            {therapist.license.state} {therapist.license.type} #{therapist.license.number}
          </p>
          {therapist.license.verified && (
            <p className="mb-1 flex items-center gap-1 text-xs text-teal-600">
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Verified
            </p>
          )}
          {bbsUrl && (
            <a
              href={bbsUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Verify ${therapist.name.display}'s ${therapist.license.type} license with the California Department of Consumer Affairs`}
              className="text-xs font-medium text-teal-600 hover:text-teal-700"
            >
              Verify with CA DCA →
            </a>
          )}
        </div>
      )}

      {/* Not the right fit */}
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <p className="mb-2 text-sm text-gray-600">
          Not the right fit? Browse similar therapists near{' '}
          {therapist.location.city}.
        </p>
        <Link
          href={`/directory?specialty=bipolar&near=${encodeURIComponent(therapist.location.city)}`}
          onClick={onFindSimilarClicked}
          className="text-sm font-medium text-purple-600 hover:text-purple-700"
        >
          Browse similar therapists →
        </Link>
      </div>
    </aside>
  )
}

// ─── MobileStickyBar ──────────────────────────────────────────────────────────

function MobileStickyBar({
  therapist,
  heroCtaRef,
  onCallTapped,
  onWebsiteTapped,
}: {
  therapist: TherapistProfile
  heroCtaRef: React.RefObject<HTMLDivElement>
  onCallTapped: () => void
  onWebsiteTapped: () => void
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = heroCtaRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [heroCtaRef])

  const { sessionFee, acceptingPatients, phone, websiteUrl, name } = therapist
  const feeLabel = sessionFee ? `$${sessionFee.min}–$${sessionFee.max}` : null

  return (
    <div
      aria-hidden={!visible}
      className={[
        'fixed bottom-0 left-0 right-0 z-40 border-t border-gray-100 bg-white shadow-lg transition-transform duration-300 md:hidden',
        visible ? 'translate-y-0' : 'translate-y-full',
      ].join(' ')}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="px-4 py-3">
        {(feeLabel || acceptingPatients) && (
          <div className="mb-2 flex items-center gap-2">
            {feeLabel && (
              <span className="text-xs font-medium text-gray-700">{feeLabel}</span>
            )}
            {sessionFee?.slidingScale && (
              <span className="text-xs text-gray-400">&middot; Sliding scale</span>
            )}
            {acceptingPatients && (
              <span className="ml-auto text-xs font-medium text-green-600">
                Accepting patients
              </span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {phone && (
            <a
              href={`tel:${phone.replace(/\D/g, '')}`}
              onClick={onCallTapped}
              aria-label={`Call ${name.display}`}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                />
              </svg>
              Call {phone}
            </a>
          )}
          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onWebsiteTapped}
              aria-label={`Visit ${name.display}'s website`}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              Website
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── JSON-LD ──────────────────────────────────────────────────────────────────

function TherapistJsonLd({ therapist }: { therapist: TherapistProfile }) {
  const pageUrl = `https://www.bipolartherapyhub.com/therapists/${therapist.slug}/`
  const siteUrl = 'https://www.bipolartherapyhub.com'
  const address = {
    '@type': 'PostalAddress',
    addressLocality: therapist.location.city,
    addressRegion: therapist.location.state,
    postalCode: therapist.location.zip,
    addressCountry: 'US',
  }

  const person = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: `${therapist.name.display}, ${therapist.credentials.join(', ')}`,
    url: pageUrl,
    jobTitle: therapist.title,
    knowsAbout: [
      'Bipolar disorder',
      'Mood disorders',
      'Psychotherapy',
      'Mental health',
      ...therapist.approaches,
    ],
    address,
    ...(therapist.phone ? { telephone: therapist.phone } : {}),
    ...(therapist.profileImage ? { image: therapist.profileImage } : {}),
    ...(therapist.education?.length
      ? {
          alumniOf: therapist.education.map((e) => ({
            '@type': 'EducationalOrganization',
            name: e.institution,
          })),
        }
      : {}),
    knowsLanguage: therapist.languages.map((l) => ({
      '@type': 'Language',
      name: l,
    })),
  }

  const medicalBusiness = {
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    name: `${therapist.name.display}, ${therapist.title}`,
    url: pageUrl,
    address,
    ...(therapist.phone ? { telephone: therapist.phone } : {}),
    priceRange: '$$',
    medicalSpecialty: 'Psychiatric',
    ...(therapist.insurance.length > 0
      ? { paymentAccepted: therapist.insurance.join(', ') }
      : {}),
    ...(therapist.location.geo
      ? {
          geo: {
            '@type': 'GeoCoordinates',
            latitude: therapist.location.geo.lat,
            longitude: therapist.location.geo.lng,
          },
        }
      : {}),
    areaServed: {
      '@type': 'State',
      name: 'California',
    },
    ...(therapist.formats.includes('telehealth')
      ? {
          availableChannel: {
            '@type': 'ServiceChannel',
            serviceType: 'Online therapy',
            availableLanguage: therapist.languages.map((l) => ({
              '@type': 'Language',
              name: l,
            })),
          },
        }
      : {}),
  }

  const breadcrumbList = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: `${siteUrl}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Therapist Directory',
        item: `${siteUrl}/directory`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: therapist.location.state,
        item: `${siteUrl}/directory?state=${therapist.location.state}`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: therapist.name.display,
        item: pageUrl,
      },
    ],
  }

  const faqItems = buildFAQItems(therapist)
  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.a,
      },
    })),
  }

  const schemas = [person, medicalBusiness, breadcrumbList, faqPage]

  return (
    <>
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  )
}

// ─── generateMetadata ─────────────────────────────────────────────────────────

// This export is ignored when the file is 'use client'.
// Copy it into therapist-page-server.tsx (server component wrapper).
// Replace KIMBERLY_LASKOWSKI with await fetchTherapistBySlug(params.slug).
export function generateMetadata(_: { params: { slug: string } }): Metadata {
  const t = KIMBERLY_LASKOWSKI

  const credStr = t.credentials.join(', ')
  const title = `${t.name.display}, ${credStr} — Bipolar Therapist in ${t.location.city}, ${t.location.state} | Bipolar Therapy Hub`

  // Description: lead with specialist identity, then key logistics — ~155 chars
  const descParts: string[] = [
    `${t.name.display} is a bipolar disorder specialist and ${t.title.toLowerCase()} in ${t.location.city}, ${t.location.state}.`,
  ]
  if (t.acceptingPatients) descParts.push('Currently accepting new patients.')
  if (t.formats.includes('telehealth') && t.formats.includes('in-person')) {
    descParts.push('Telehealth and in-person.')
  } else if (t.formats.includes('telehealth')) {
    descParts.push('Telehealth available.')
  }
  if (t.sessionFee) {
    const sliding = t.sessionFee.slidingScale ? ' Sliding scale.' : ''
    descParts.push(`$${t.sessionFee.min}–$${t.sessionFee.max}/session.${sliding}`)
  }
  if (t.insurance.length > 0) {
    descParts.push(`Accepts ${t.insurance.slice(0, 2).join(', ')}.`)
  }

  const fullDesc = descParts.join(' ')
  const description = fullDesc.length <= 158 ? fullDesc : `${fullDesc.slice(0, 155)}…`

  const url = `https://www.bipolartherapyhub.com/therapists/${t.slug}/`

  return {
    title,
    description,
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: 'profile',
      url,
      siteName: 'Bipolar Therapy Hub',
      locale: 'en_US',
      ...(t.profileImage ? { images: [{ url: t.profileImage, alt: t.name.display }] } : {}),
    },
    twitter: {
      card: 'summary',
      title,
      description,
      ...(t.profileImage ? { images: [t.profileImage] } : {}),
    },
    other: {
      'article:section': 'Therapist Directory',
    },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TherapistPage(_: { params: { slug: string } }) {
  // In production: replace with server-fetched data keyed by params.slug
  const therapist = KIMBERLY_LASKOWSKI

  const { toast, showToast } = useToast()
  const heroCtaRef = useRef<HTMLDivElement>(null)
  const track = useProfileAnalytics(therapist.id)

  // ── Saved state ───────────────────────────────────────────────────────────
  const SAVED_KEY = 'bth_saved_therapists'
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      const list: string[] = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
      setSaved(list.includes(therapist.id))
    } catch {
      // localStorage unavailable
    }
  }, [therapist.id])

  const handleSaveToggle = (next: boolean) => {
    setSaved(next)
    track.trackSaveToggled(next)
    try {
      const list: string[] = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
      const updated = next
        ? [...new Set([...list, therapist.id])]
        : list.filter((id) => id !== therapist.id)
      localStorage.setItem(SAVED_KEY, JSON.stringify(updated))
    } catch {
      // best-effort
    }
    showToast(next ? 'Saved to your list' : 'Removed from your list')
  }

  // ── Share ─────────────────────────────────────────────────────────────────
  const handleShare = async () => {
    const url = `https://www.bipolartherapyhub.com/therapists/${therapist.slug}/`
    const shareTitle = `${therapist.name.display} — Bipolar Therapist in ${therapist.location.city}`
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url })
      } catch {
        // user cancelled or API unavailable
      }
    } else {
      try {
        await navigator.clipboard.writeText(url)
        showToast('Link copied to clipboard')
      } catch {
        // best-effort
      }
    }
  }

  // ── Navigation context ────────────────────────────────────────────────────
  const [backLabel, setBackLabel] = useState('Therapist Directory')
  const [matchParam, setMatchParam] = useState<string | null>(null)

  useEffect(() => {
    try {
      if (document.referrer.includes('/match')) {
        setBackLabel('Back to your matches')
      }
      const params = new URLSearchParams(window.location.search)
      setMatchParam(params.get('match'))

      const scrollKey = `bth_scroll_${document.referrer}`
      const y = sessionStorage.getItem(scrollKey)
      if (y) {
        window.scrollTo({ top: parseInt(y), behavior: 'instant' })
        sessionStorage.removeItem(scrollKey)
      }
    } catch {
      // best-effort
    }
  }, [])

  // ── CTA handlers ──────────────────────────────────────────────────────────
  const callHandlers = {
    hero: () => track.trackCallTapped('hero'),
    sidebar: () => track.trackCallTapped('sidebar'),
    mobile_bar: () => track.trackCallTapped('mobile_bar'),
  } as const

  return (
    <>
      <TherapistJsonLd therapist={therapist} />

      {/* Skip nav */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-purple-700 focus:shadow-md"
      >
        Skip to main content
      </a>

      <div className="min-h-screen bg-gray-50">
        <SiteHeader
          therapist={therapist}
          saved={saved}
          onSaveToggle={handleSaveToggle}
          onShare={handleShare}
        />

        <MatchBanner matchParam={matchParam} />

        <Breadcrumb therapist={therapist} backLabel={backLabel} />

        <JumpNav hasEducation={!!therapist.education?.length} />

        <main id="main-content" className="mx-auto max-w-5xl px-4 pb-28 md:pb-10">
          <div className="flex items-start gap-6">
            {/* ── Main column ── */}
            <div className="min-w-0 flex-1">
              <Hero
                therapist={therapist}
                heroCtaRef={heroCtaRef}
                onCallTapped={callHandlers.hero}
                onWebsiteTapped={track.trackWebsiteTapped}
                onReminderSet={() => {
                  track.trackReminderSet()
                  showToast('Reminder set for 48 hours from now')
                }}
              />

              <TrustBar therapist={therapist} />

              <QuickStats therapist={therapist} />

              <BioSection bio={therapist.bio} />

              <EducationSection education={therapist.education} />

              <FocusAreasSection specialties={therapist.specialties} />

              <TherapeuticApproachSection
                approaches={therapist.approaches}
                therapistFirstName={therapist.name.first}
              />

              <InsuranceSection insurance={therapist.insurance} />

              <ReachOutModule
                therapist={therapist}
                onScriptCopied={track.trackScriptCopied}
                showToast={showToast}
              />

              <FAQSection
                therapist={therapist}
                onFaqExpanded={track.trackFaqExpanded}
              />

              {/* Find similar */}
              <div className="mb-4 mt-2 text-center">
                <Link
                  href={`/directory?specialty=bipolar&location=${encodeURIComponent(
                    `${therapist.location.city}, ${therapist.location.state}`,
                  )}&insurance=${encodeURIComponent(therapist.insurance[0] ?? '')}`}
                  onClick={track.trackFindSimilarClicked}
                  className="text-sm font-medium text-purple-600 hover:text-purple-700"
                >
                  Find similar therapists near {therapist.location.city} →
                </Link>
              </div>
            </div>

            {/* ── Sidebar ── */}
            <Sidebar
              therapist={therapist}
              onCallTapped={callHandlers.sidebar}
              onFindSimilarClicked={track.trackFindSimilarClicked}
            />
          </div>
        </main>

        <MobileStickyBar
          therapist={therapist}
          heroCtaRef={heroCtaRef}
          onCallTapped={callHandlers.mobile_bar}
          onWebsiteTapped={track.trackWebsiteTapped}
        />

        <Toast message={toast.message} visible={toast.visible} />
      </div>
    </>
  )
}
