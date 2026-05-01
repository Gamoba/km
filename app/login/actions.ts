'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'

export type AuthState = {
  error: string | null
  mode: 'login' | 'signup'
}

export async function signIn(
  prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (!email || typeof email !== 'string' || !email.trim()) {
    return { ...prevState, error: 'Indtast en gyldig e-mailadresse.' }
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return { ...prevState, error: 'Adgangskoden skal være mindst 6 tegn.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })

  if (error) {
    return { ...prevState, error: error.message }
  }

  redirect('/dashboard')
}

export async function signUp(
  prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (!email || typeof email !== 'string' || !email.trim()) {
    return { ...prevState, error: 'Indtast en gyldig e-mailadresse.' }
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return { ...prevState, error: 'Adgangskoden skal være mindst 6 tegn.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  })

  if (error) {
    return { ...prevState, error: error.message }
  }

  return { mode: 'login', error: null }
}
