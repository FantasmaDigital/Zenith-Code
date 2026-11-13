import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

const card = 'bg-[#171717] border border-[#2e2e2e] rounded-lg p-6 space-y-4';
const input = 'w-full h-10 bg-[#121212] border border-[#2e2e2e] rounded-md px-3 text-sm outline-none transition-colors focus:border-zinc-500';

export const getResetToken = () => {
  try { return new URLSearchParams(window.location.search).get('restablecer') || ''; } catch { return ''; }
};

const clearResetParam = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete('restablecer');
  window.history.replaceState(null, '', url.pathname + url.search);
};

function SubmitButton({ loading, color, textColor, children }) {
  return (
    <button type="submit" disabled={loading}
      className="w-full h-10 rounded-md text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
      style={{ backgroundColor: color, color: textColor }}>
      {loading && <RefreshCw size={14} className="animate-spin" />}{children}
    </button>
  );
}

// Pide el enlace. La respuesta es la misma exista o no la cuenta.
export function ForgotPasswordForm({ apiBase, tenant, color, textColor, onBack }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email.includes('@')) { setError('Escribe el correo de tu cuenta.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${apiBase}/api/public/password-reset/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), tenant })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) { setError('Demasiadas solicitudes. Intenta de nuevo en unos minutos.'); return; }
      setDone(data.message || 'Si el correo tiene una cuenta, te enviamos un enlace.');
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className={card} noValidate>
      <div>
        <h2 className="text-sm font-medium text-zinc-100">Restablecer contraseña</h2>
        <p className="mt-1 text-[13px] text-zinc-400">Te enviaremos un enlace a tu correo. Vence en 30 minutos.</p>
      </div>
      {done ? (
        <p className="text-[13px] text-emerald-300">{done} Revisa también la carpeta de spam.</p>
      ) : (
        <>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com"
            autoComplete="email" autoFocus className={input} />
          {error && <p className="text-[13px] text-rose-400">{error}</p>}
          <SubmitButton loading={loading} color={color} textColor={textColor}>Enviar enlace</SubmitButton>
        </>
      )}
      <button type="button" onClick={onBack} className="w-full text-center text-[12px] text-zinc-500 hover:text-zinc-300">
        Volver a iniciar sesión
      </button>
    </form>
  );
}

// Llega desde el enlace del correo (?restablecer=token): define la contraseña nueva
export function ResetPasswordForm({ apiBase, token, color, textColor, onDone }) {
  const [valid, setValid] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/api/public/password-reset/${encodeURIComponent(token)}`)
      .then(r => setValid(r.ok)).catch(() => setValid(false));
  }, [apiBase, token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) { setError('Usa al menos 8 caracteres.'); return; }
    if (password !== confirm) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`${apiBase}/api/public/password-reset/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.detail === 'string' ? data.detail : 'No se pudo cambiar la contraseña.'); return; }
      setOk(true);
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally { setLoading(false); }
  };

  // Recarga sin el token: con sesión abierta vuelve al panel; sin sesión, al formulario de acceso
  const finish = () => { clearResetParam(); onDone(); window.location.replace(window.location.pathname); };

  if (valid === null) return <div className={`${card} text-[13px] text-zinc-400`}>Verificando enlace…</div>;
  if (!valid || ok) {
    return (
      <div className={card}>
        <p className={`text-[13px] ${ok ? 'text-emerald-300' : 'text-zinc-300'}`}>
          {ok ? 'Listo: tu contraseña cambió. Ya puedes iniciar sesión.' : 'El enlace no es válido o ya venció. Pide uno nuevo.'}
        </p>
        <button type="button" onClick={finish} className="w-full h-10 rounded-md text-sm font-medium"
          style={{ backgroundColor: color, color: textColor }}>
          Ir a iniciar sesión
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className={card} noValidate>
      <h2 className="text-sm font-medium text-zinc-100">Crea tu contraseña nueva</h2>
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña nueva (mín. 8)"
        autoComplete="new-password" autoFocus className={input} />
      <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repite la contraseña"
        autoComplete="new-password" className={input} />
      {error && <p className="text-[13px] text-rose-400">{error}</p>}
      <SubmitButton loading={loading} color={color} textColor={textColor}>Guardar contraseña</SubmitButton>
    </form>
  );
}
