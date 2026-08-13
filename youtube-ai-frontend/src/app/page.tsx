import { redirect } from 'next/navigation'

export default function Home() {
  // Server-side redirect — auth check happens client-side in dashboard layout
  redirect('/login')
}
