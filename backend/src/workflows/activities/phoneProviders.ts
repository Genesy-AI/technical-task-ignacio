const ORION_CONNECT_URL = process.env.ORION_CONNECT_URL!
const ORION_CONNECT_API_KEY = process.env.ORION_CONNECT_API_KEY!

const ASTRA_DIALER_URL = process.env.ASTRA_DIALER_URL!
const ASTRA_DIALER_API_KEY = process.env.ASTRA_DIALER_API_KEY!

const NIMBUS_LOOKUP_URL = process.env.NIMBUS_LOOKUP_URL!
const NIMBUS_LOOKUP_API_KEY = process.env.NIMBUS_LOOKUP_API_KEY!

export async function fetchPhoneOrionConnect(
  fullName: string,
  companyWebsite: string,
): Promise<string | null> {
  const response = await fetch(ORION_CONNECT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-auth-me': ORION_CONNECT_API_KEY,
    },
    body: JSON.stringify({ fullName, companyWebsite }),
  })

  if (!response.ok) {
    throw new Error(`Orion Connect responded with ${response.status}`)
  }

  const data = (await response.json()) as { phone: string | null }
  return data.phone ?? null
}

export async function fetchPhoneAstraDialer(email: string): Promise<string | null> {
  const response = await fetch(ASTRA_DIALER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apiKey: ASTRA_DIALER_API_KEY,
    },
    body: JSON.stringify({ email }),
  })

  if (!response.ok) {
    throw new Error(`Astra Dialer responded with ${response.status}`)
  }

  const data = (await response.json()) as { phoneNmbr?: string | null }
  return data.phoneNmbr ?? null
}

export async function fetchPhoneNimbusLookup(
  email: string,
  jobTitle: string,
): Promise<string | null> {
  const url = new URL(NIMBUS_LOOKUP_URL)
  url.searchParams.set('api', NIMBUS_LOOKUP_API_KEY)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, jobTitle }),
  })

  if (!response.ok) {
    throw new Error(`Nimbus Lookup responded with ${response.status}`)
  }

  const data = (await response.json()) as { number?: number; countryCode?: string }
  if (data.number == null) return null
  return data.countryCode ? `+${data.countryCode}${data.number}` : String(data.number)
}
