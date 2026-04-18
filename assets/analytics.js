/**
 * Vercel Web Analytics initialization module
 * This module initializes Vercel Web Analytics for the application
 * Import and call initAnalytics() in each page entry point
 */
import { inject } from '@vercel/analytics';

/**
 * Initialize Vercel Web Analytics
 * Should be called once per page load
 */
export function initAnalytics() {
  inject();
}
