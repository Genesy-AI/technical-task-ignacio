export type LeadsEnrichPhoneInput = {
  leadIds: number[]
}

export type LeadsEnrichPhoneOutput = {
  success: boolean
  enrichedCount: number
  results: Array<{ leadId: number; phoneNumber: string | null }>
  errors: Array<{ leadId: number; leadName: string; error: string }>
}
