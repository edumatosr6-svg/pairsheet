import { useEffect, useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status')
      .then(async response => {
        if (!response.ok) throw Error();
        const data = await response.json() as { needsSetup: boolean };
        setSetup(data.needsSetup);
        setReady(true);
      })
      .catch(() => setError('Não foi possível verificar o acesso. Atualize a página.'));
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/' + (setup ? 'setup' : 'login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw Error(data.error || 'Não foi possível entrar.');
      onSuccess();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="login panel">
    <div className="brand-mark"><LockKeyhole size={30} /></div>
    <h2>{setup ? 'Configure o acesso' : 'Bem-vindo ao SIMAS'}</h2>
    <p>{setup ? 'Defina a senha para começar.' : 'Digite a senha para acessar a escala.'}</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {ready && <form className="login-form" onSubmit={submit}>
      {setup && <>
        <label className="field"><span>Código de instalação</span><input name="token" type="password" required autoComplete="off" placeholder="Código definido na hospedagem" /></label>
        <label className="field"><span>Seu nome</span><input name="name" required minLength={2} autoComplete="name" /></label>
        <label className="field"><span>E-mail</span><input name="email" type="email" required autoComplete="email" /></label>
      </>}
      <label className="field"><span>Senha de acesso</span><input name="password" type="password" required minLength={12} maxLength={128} autoComplete={setup ? 'new-password' : 'current-password'} placeholder={setup ? 'Pelo menos 12 caracteres' : 'Sua senha'} /></label>
      <button className="button primary" disabled={busy} type="submit">{busy ? 'Aguarde…' : setup ? 'Criar acesso' : 'Entrar'}<ArrowRight size={17} /></button>
    </form>}
    <small>{setup ? 'O código impede que terceiros configurem o primeiro acesso.' : 'Guarde sua senha em um lugar seguro.'}</small>
  </section>;
}

export function PasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/access/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw Error(data.error || 'Não foi possível atualizar a senha.');
      onSuccess();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit}>
    {error && <div className="alert error" role="alert">{error}</div>}
    <label className="field"><span>Nova senha</span><input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>
    <p className="form-hint">Depois de trocar a senha, entre novamente nos dispositivos abertos.</p>
    <div className="modal-footer"><button className="button primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button></div>
  </form>;
}
