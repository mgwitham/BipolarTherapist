/**
 * Server Component wrapper for the therapist profile page.
 * Next.js 14 App Router: save as app/therapists/[slug]/page.tsx
 *
 * This file stays a Server Component (no 'use client') so that:
 *   1. generateMetadata runs server-side — title/description are in the
 *      initial HTML response, visible to Google before JS executes.
 *   2. TherapistProfileClient is the interactive shell; it hydrates
 *      in the browser with the pre-fetched therapist data.
 *
 * Setup:
 *   - Move therapist-profile.tsx → app/therapists/[slug]/TherapistProfileClient.tsx
 *   - Rename its default export to TherapistProfileClient
 *   - Add TherapistProfile prop: ({ therapist }: { therapist: TherapistProfile })
 *   - Remove the KIMBERLY_LASKOWSKI fallback from that component's body
 */

import { notFound } from 'next/navigation'
import { cache } from 'react'
import type { Metadata } from 'next'
import TherapistProfileClient, {
  generateMetadata as buildMetadata,
  buildFAQItems,
  type TherapistProfile,
} from './TherapistProfileClient' // rename of therapist-profile.tsx

// ─── Data Fetching ────────────────────────────────────────────────────────────

// Wrap in React `cache` so the same slug is only fetched once per request,
// even when called from both generateMetadata and the page component.
const getTherapist = cache(async (slug: string): Promise<TherapistProfile | null> => {
  // Replace with your Sanity fetch. Example using the project's existing cms helper:
  //
  //   import { fetchPublicTherapistBySlug } from '@/assets/cms'
  //   const raw = await fetchPublicTherapistBySlug(slug)
  //   if (!raw) return null
  //   return mapSanityDocToTherapistProfile(raw)
  //
  // During development, return the seed data keyed by slug:
  const { KIMBERLY_LASKOWSKI } = await import('./TherapistProfileClient')
  if (KIMBERLY_LASKOWSKI.slug === slug) return KIMBERLY_LASKOWSKI
  return null
})

// ─── Metadata (server-side, SEO-critical) ────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const therapist = await getTherapist(params.slug)
  if (!therapist) {
    return {
      title: 'Therapist Not Found | Bipolar Therapy Hub',
      robots: { index: false, follow: false },
    }
  }

  // Delegate to the shared builder so metadata and page stay in sync.
  // buildMetadata ignores its params arg (uses the passed therapist directly)
  // — swap its internals for the fetched therapist object when you refactor.
  return buildMetadata({ params })
}

// ─── Static Params (optional — enables full static generation) ────────────────

// Uncomment to pre-render every therapist profile at build time:
//
// export async function generateStaticParams() {
//   const slugs = await fetchAllPublishedTherapistSlugs()
//   return slugs.map((slug) => ({ slug }))
// }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TherapistPage({
  params,
}: {
  params: { slug: string }
}) {
  const therapist = await getTherapist(params.slug)

  if (!therapist) {
    notFound() // renders app/not-found.tsx
  }

  return <TherapistProfileClient params={params} />
}

// ─── Sanity shape → TherapistProfile mapper (fill in as needed) ──────────────

// function mapSanityDocToTherapistProfile(doc: SanityTherapistDoc): TherapistProfile {
//   return {
//     id: doc._id,
//     slug: doc.slug?.current ?? doc._id,
//     name: {
//       first: doc.firstName ?? '',
//       last: doc.lastName ?? '',
//       display: doc.name ?? `${doc.firstName} ${doc.lastName}`,
//     },
//     credentials: (doc.credentials ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
//     title: doc.title ?? '',
//     license: doc.licenseNumber
//       ? { state: doc.licenseState ?? 'CA', type: doc.licenseType ?? 'LMFT', number: doc.licenseNumber }
//       : null,
//     location: {
//       city: doc.city ?? '',
//       state: doc.state ?? 'CA',
//       zip: doc.zip ?? '',
//     },
//     phone: doc.phone ?? null,
//     websiteUrl: doc.websiteUrl ?? null,
//     bio: Array.isArray(doc.bio) ? doc.bio : [doc.bio ?? ''].filter(Boolean),
//     specialties: (doc.specialties ?? []).map((s: string) => ({
//       label: s,
//       isPrimary: s.toLowerCase().includes('bipolar'),
//     })),
//     approaches: doc.approaches ?? [],
//     formats: doc.formats ?? [],
//     insurance: doc.insurance ?? [],
//     sessionFee: doc.sessionFeeMin
//       ? { min: doc.sessionFeeMin, max: doc.sessionFeeMax ?? doc.sessionFeeMin, slidingScale: doc.slidingScale ?? false }
//       : null,
//     languages: doc.languages ?? ['English'],
//     acceptingPatients: doc.acceptingPatients ?? false,
//     experience: doc.yearsExperience ?? null,
//     profileImage: doc.photo?.asset?.url ?? null,
//   }
// }
