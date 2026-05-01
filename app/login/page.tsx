'use client'

import { useActionState } from 'react'
import { signIn, signUp, type AuthState } from './actions'
import { useState } from 'react'

const initialState: AuthState = { error: null, mode: 'login' }

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loginState, loginAction, isLoginPending] = useActionState(signIn, initialState)
  const [signupState, signupAction, isSignupPending] = useActionState(signUp, initialState)

  const state = mode === 'login' ? loginState : signupState
  const formAction = mode === 'login' ? loginAction : signupAction
  const isPending = mode === 'login' ? isLoginPending : isSignupPending

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            {mode === 'login' ? 'Log ind' : 'Opret konto'}
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {mode === 'login'
              ? 'Log ind med din e-mail og adgangskode.'
              : 'Opret en ny konto med e-mail og adgangskode.'}
          </p>

          {mode === 'signup' && signupState.error === null && signupState !== initialState ? (
            <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center">
              <p className="text-sm font-medium text-green-800">Konto oprettet</p>
              <p className="text-sm text-green-700 mt-1">
                Du kan nu logge ind med din e-mail og adgangskode.
              </p>
              <button
                onClick={() => setMode('login')}
                className="mt-3 text-sm font-medium text-green-800 underline"
              >
                Gå til login
              </button>
            </div>
          ) : (
            <form action={formAction} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  E-mailadresse
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="dig@eksempel.dk"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                  disabled={isPending}
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  Adgangskode
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 shadow-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50"
                  disabled={isPending}
                />
              </div>

              {state.error && (
                <p className="text-sm text-red-600" role="alert">
                  {state.error}
                </p>
              )}

              <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {isPending
                  ? 'Vent…'
                  : mode === 'login'
                  ? 'Log ind'
                  : 'Opret konto'}
              </button>

              <p className="text-center text-sm text-gray-500">
                {mode === 'login' ? (
                  <>
                    Ingen konto?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('signup')}
                      className="font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      Opret én her
                    </button>
                  </>
                ) : (
                  <>
                    Har du allerede en konto?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="font-medium text-indigo-600 hover:text-indigo-500"
                    >
                      Log ind
                    </button>
                  </>
                )}
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
