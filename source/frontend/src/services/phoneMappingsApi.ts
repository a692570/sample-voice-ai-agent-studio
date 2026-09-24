/**
 * Phone Mappings API Service
 *
 * Maps a phone number -> agent/demo so telephony (PSTN/SIP, deployed separately)
 * can route an incoming call to the right agent. Numbers are configured here in
 * the UI after the user has provisioned them with their telephony provider.
 */

import { apiRequest } from './apiClient';

export type PhoneProvider = 'pstn' | 'sip';

export interface PhoneMapping {
  phoneNumber: string;        // E.164, e.g. "+15102886599"
  demoId: string;             // the agent/demo this number routes to
  demoName?: string;
  provider: PhoneProvider;    // "pstn" or "sip"
  label?: string;             // free-form label, e.g. "Twilio PSTN"
  config?: Record<string, unknown>;
  updatedAt?: string;
}

export interface UpsertPhoneMappingInput {
  demoId: string;
  demoName?: string;
  provider: PhoneProvider;
  label?: string;
  config?: Record<string, unknown>;
}

/** The backend keys on a normalized E.164 number; encode it for the path. */
function encodePhone(phone: string): string {
  return encodeURIComponent(phone.trim());
}

/** Whether each provider's bridge config has been set up (secret exists). */
export interface TelephonyConfigStatus {
  pstn: boolean;
  sip: boolean;
}

export function listPhoneMappings(): Promise<PhoneMapping[]> {
  return apiRequest<PhoneMapping[]>('/phone-mappings');
}

/** Reports whether the PSTN/SIP bridge config secrets exist. Values are never
 *  exposed — this only tells the UI whether a provider is configured. */
export function getTelephonyConfigStatus(): Promise<TelephonyConfigStatus> {
  return apiRequest<TelephonyConfigStatus>('/phone-mappings/status');
}

export function getPhoneMapping(phone: string): Promise<PhoneMapping> {
  return apiRequest<PhoneMapping>(`/phone-mappings/${encodePhone(phone)}`);
}

export function upsertPhoneMapping(
  phone: string,
  data: UpsertPhoneMappingInput
): Promise<PhoneMapping> {
  return apiRequest<PhoneMapping>(`/phone-mappings/${encodePhone(phone)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deletePhoneMapping(phone: string): Promise<{ message: string; phoneNumber: string }> {
  return apiRequest<{ message: string; phoneNumber: string }>(`/phone-mappings/${encodePhone(phone)}`, {
    method: 'DELETE',
  });
}
