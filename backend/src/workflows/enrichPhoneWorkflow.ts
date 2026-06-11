import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from './activities'

const { fetchPhoneOrionConnect, fetchPhoneAstraDialer, fetchPhoneNimbusLookup } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: '15 seconds',
    retry: {
      maximumAttempts: 3,
      initialInterval: '1 second',
      backoffCoefficient: 2,
    },
  })

// Per-provider minimum delay between requests.
// Set to '0 milliseconds' until providers announce rate limits.
const ORION_CONNECT_RATE_LIMIT_MS = '0 milliseconds'
const ASTRA_DIALER_RATE_LIMIT_MS = '0 milliseconds'

export async function enrichPhoneWorkflow(
  fullName: string,
  email: string,
  jobTitle: string,
  emailDomain: string,
): Promise<string> {
  try {
    const phone = await fetchPhoneOrionConnect(fullName, emailDomain)
    if (phone) return phone
  } catch {
    // provider failed after retries — fall through to next
  }
  await sleep(ORION_CONNECT_RATE_LIMIT_MS)

  try {
    const phone = await fetchPhoneAstraDialer(email)
    if (phone) return phone
  } catch {
    // provider failed after retries — fall through to next
  }
  await sleep(ASTRA_DIALER_RATE_LIMIT_MS)

  try {
    const phone = await fetchPhoneNimbusLookup(email, jobTitle)
    if (phone) return phone
  } catch {
    // all providers failed
  }

  return 'No data found'
}
