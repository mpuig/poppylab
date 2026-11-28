/**
 * The agent's own lines, the ones its code writes, in each language it
 * speaks (`language.ts`): its questions, what it says it did, its buttons
 * and its refusals. The facts in them (Company names, amounts, the User's
 * own words) are filled in by code, exactly; only the sentence around them
 * changes with the language. The agent speaks for itself: "I", never its
 * name, so no line names it.
 *
 * Plain data and no I/O, so a page can say the same lines.
 */
import { capital, listIn, quoteIn, type Language } from "./language";

type Line<P> = Record<Language, (p: P) => string>;
const line = <P = Record<string, never>>(l: Line<P>): Line<P> => l;

const list = listIn;
const q = quoteIn;
type Names = { names: readonly string[] };
type Name = { name: string };
/** "approved" or "declined", and whether it was an approval. */
type Done = { approve: boolean };

const done = {
  en: (d: Done) => (d.approve ? "approved" : "declined"),
  es: (d: Done) => (d.approve ? "aprobado" : "rechazado"),
  ca: (d: Done) => (d.approve ? "aprovat" : "rebutjat"),
  fr: (d: Done) => (d.approve ? "approuvé" : "refusé"),
};

export const LINES = {
  // ── Buttons ────────────────────────────────────────────────────────
  approveButton: line<{ what: string }>({
    en: (p) => `Approve ${p.what}`,
    es: (p) => `Aprobar ${p.what}`,
    ca: (p) => `Aprovar ${p.what}`,
    fr: (p) => `Approuver ${p.what}`,
  }),
  declineButton: line<{ what: string }>({
    en: (p) => `Decline ${p.what}`,
    es: (p) => `Rechazar ${p.what}`,
    ca: (p) => `Rebutjar ${p.what}`,
    fr: (p) => `Refuser ${p.what}`,
  }),
  thisChange: line({
    en: () => "this change",
    es: () => "este cambio",
    ca: () => "aquest canvi",
    fr: () => "cette modification",
  }),
  proposalAt: line<Name>({
    en: (p) => `the proposal at ${p.name}`,
    es: (p) => `la propuesta de ${p.name}`,
    ca: (p) => `la proposta de ${p.name}`,
    fr: (p) => `la proposition de ${p.name}`,
  }),
  signInButton: line<Name>({
    en: (p) => `Sign in to ${p.name} · read only`,
    es: (p) => `Iniciar sesión en ${p.name} · solo lectura`,
    ca: (p) => `Iniciar sessió a ${p.name} · només lectura`,
    fr: (p) => `Se connecter à ${p.name} · lecture seule`,
  }),
  writeButton: line<Name>({
    en: (p) => `Request change permission at ${p.name}`,
    es: (p) => `Pedir permiso de cambios en ${p.name}`,
    ca: (p) => `Demanar permís de canvis a ${p.name}`,
    fr: (p) => `Demander l'autorisation de modifier chez ${p.name}`,
  }),
  signOutButton: line<Name>({
    en: (p) => `Sign out of ${p.name}`,
    es: (p) => `Cerrar sesión en ${p.name}`,
    ca: (p) => `Tancar sessió a ${p.name}`,
    fr: (p) => `Se déconnecter de ${p.name}`,
  }),
  resumeButton: line({
    en: () => "Yes, go on",
    es: () => "Sí, sigue",
    ca: () => "Sí, continua",
    fr: () => "Oui, continuez",
  }),
  talkButton: line<Name>({
    en: (p) => `Talk to ${p.name}`,
    es: (p) => `Hablar con ${p.name}`,
    ca: (p) => `Parlar amb ${p.name}`,
    fr: (p) => `Parler avec ${p.name}`,
  }),
  notNowButton: line({
    en: () => "Not now",
    es: () => "Ahora no",
    ca: () => "Ara no",
    fr: () => "Pas maintenant",
  }),
  removeButton: line<Names>({
    en: (p) => `Remove ${list("en", p.names)}`,
    es: (p) => `Quitar ${list("es", p.names)}`,
    ca: (p) => `Treure ${list("ca", p.names)}`,
    fr: (p) => `Retirer ${list("fr", p.names)}`,
  }),
  keepButton: line<Names>({
    en: (p) => `Keep ${list("en", p.names)}`,
    es: (p) => `Mantener ${list("es", p.names)}`,
    ca: (p) => `Mantenir ${list("ca", p.names)}`,
    fr: (p) => `Garder ${list("fr", p.names)}`,
  }),

  // ── The page's blocks about an account, in the conversation ────────
  askSignIn: line<Name>({
    en: (p) =>
      `I can read your ${p.name} account once you sign in, read only, on ${p.name}'s own page. Account access is optional; only connect accounts you trust.`,
    es: (p) =>
      `Puedo leer tu cuenta de ${p.name} cuando inicies sesión, solo lectura, en la propia página de ${p.name}. El acceso a la cuenta es opcional; conecta solo cuentas en las que confíes.`,
    ca: (p) =>
      `Puc llegir el teu compte de ${p.name} quan hi iniciïs sessió, només de lectura, a la pàgina de ${p.name}. L'accés al compte és opcional; connecta només comptes en què confiïs.`,
    fr: (p) =>
      `Je peux lire votre compte ${p.name} une fois que vous vous connectez, en lecture seule, sur la page de ${p.name}. L'accès au compte est facultatif ; ne connectez que des comptes de confiance.`,
  }),
  askWrite: line<Name>({
    en: (p) =>
      `To ask ${p.name} for a change, I need change permission there. It opens ${p.name}'s consent page again, and you approve the change itself separately.`,
    es: (p) =>
      `Para pedir un cambio a ${p.name}, necesito permiso para hacer cambios allí. Se vuelve a abrir la página de consentimiento de ${p.name}, y el cambio en sí lo apruebas aparte.`,
    ca: (p) =>
      `Per demanar un canvi a ${p.name}, necessito permís per fer-hi canvis. Es torna a obrir la pàgina de consentiment de ${p.name}, i el canvi l'aproves a part.`,
    fr: (p) =>
      `Pour demander une modification à ${p.name}, il me faut l'autorisation de modifier. La page de consentement de ${p.name} s'ouvre à nouveau, et vous approuvez la modification elle-même à part.`,
  }),
  waitingForYou: line({
    en: () => "Waiting for you",
    es: () => "Te espera",
    ca: () => "T'espera",
    fr: () => "Vous attend",
  }),
  askUnderway: line<Name>({
    en: (p) =>
      `Finish signing in on ${p.name}'s own page, in its tab. I never see your password.`,
    es: (p) =>
      `Termina de iniciar sesión en la página de ${p.name}, en su pestaña. Nunca veo tu contraseña.`,
    ca: (p) =>
      `Acaba d'iniciar sessió a la pàgina de ${p.name}, a la seva pestanya. Mai no veig la teva contrasenya.`,
    fr: (p) =>
      `Terminez la connexion sur la page de ${p.name}, dans son onglet. Je ne vois jamais votre mot de passe.`,
  }),
  askLost: line<Name>({
    en: (p) =>
      `${p.name} no longer takes your sign-in. Sign in again to go on with your account there.`,
    es: (p) =>
      `${p.name} ya no acepta tu sesión. Vuelve a iniciar sesión para seguir con tu cuenta allí.`,
    ca: (p) =>
      `${p.name} ja no accepta la teva sessió. Torna a iniciar sessió per continuar amb el teu compte.`,
    fr: (p) =>
      `${p.name} n'accepte plus votre connexion. Reconnectez-vous pour continuer avec votre compte.`,
  }),
  askInvitation: line<Name & { reason?: string | undefined }>({
    en: (p) =>
      `${p.name} asks to talk with you directly${p.reason ? `: ${p.reason}` : "."} I won't read or answer there; you can leave at any time.`,
    es: (p) =>
      `${p.name} pide hablar contigo directamente${p.reason ? `: ${p.reason}` : "."} Yo no leo ni respondo allí; puedes salir cuando quieras.`,
    ca: (p) =>
      `${p.name} demana parlar amb tu directament${p.reason ? `: ${p.reason}` : "."} Jo no hi llegeixo ni hi responc; pots sortir quan vulguis.`,
    fr: (p) =>
      `${p.name} demande à vous parler directement${p.reason ? ` : ${p.reason}` : "."} Je n'y lis ni n'y réponds ; vous pouvez partir à tout moment.`,
  }),
  openPageAgain: line<Name>({
    en: (p) => `Open ${p.name}'s page again`,
    es: (p) => `Volver a abrir la página de ${p.name}`,
    ca: (p) => `Tornar a obrir la pàgina de ${p.name}`,
    fr: (p) => `Rouvrir la page de ${p.name}`,
  }),
  requestChangeButton: line({
    en: () => "Request change permission",
    es: () => "Pedir permiso de cambios",
    ca: () => "Demanar permís de canvis",
    fr: () => "Demander l'autorisation de modifier",
  }),
  signInAgainButton: line<Name>({
    en: (p) => `Sign in to ${p.name} again`,
    es: (p) => `Volver a iniciar sesión en ${p.name}`,
    ca: (p) => `Tornar a iniciar sessió a ${p.name}`,
    fr: (p) => `Se reconnecter à ${p.name}`,
  }),
  askDoneWrite: line<Name>({
    en: (p) => `Change permission given at ${p.name}`,
    es: (p) => `Permiso de cambios dado en ${p.name}`,
    ca: (p) => `Permís de canvis donat a ${p.name}`,
    fr: (p) => `Autorisation de modifier donnée chez ${p.name}`,
  }),
  askDoneSignIn: line<Name & { write: boolean }>({
    en: (p) =>
      `Signed in at ${p.name} · ${p.write ? "can propose changes" : "read only"}`,
    es: (p) =>
      `Sesión iniciada en ${p.name} · ${p.write ? "puede proponer cambios" : "solo lectura"}`,
    ca: (p) =>
      `Sessió iniciada a ${p.name} · ${p.write ? "pot proposar canvis" : "només lectura"}`,
    fr: (p) =>
      `Connexion à ${p.name} faite · ${p.write ? "peut proposer des modifications" : "lecture seule"}`,
  }),

  // ── Sign-in, and going on after it ─────────────────────────────────
  signInAsk: line<Name & { request?: string | undefined }>({
    en: (p) =>
      p.request
        ? `Sign in on ${p.name}'s own page to go on with ${q("en", p.request)}? It's read only, and I never see your password.`
        : `Sign in to ${p.name}? You do it on ${p.name}'s own page, read only, and I never see your password.`,
    es: (p) =>
      p.request
        ? `¿Inicias sesión en la página de ${p.name} para seguir con ${q("es", p.request)}? Es solo lectura y nunca veo tu contraseña.`
        : `¿Inicias sesión en ${p.name}? Se hace en la propia página de ${p.name}, solo lectura, y nunca veo tu contraseña.`,
    ca: (p) =>
      p.request
        ? `Inicies sessió a la pàgina de ${p.name} per continuar amb ${q("ca", p.request)}? És només de lectura i mai no veig la teva contrasenya.`
        : `Inicies sessió a ${p.name}? Es fa a la pàgina de ${p.name}, només de lectura, i mai no veig la teva contrasenya.`,
    fr: (p) =>
      p.request
        ? `Vous connecter sur la page de ${p.name} pour continuer ${q("fr", p.request)} ? C'est en lecture seule, et je ne vois jamais votre mot de passe.`
        : `Vous connecter à ${p.name} ? Cela se fait sur la page de ${p.name}, en lecture seule, et je ne vois jamais votre mot de passe.`,
  }),
  signInAskSpoken: line<Name & { goOn: boolean }>({
    en: (p) =>
      `Sign in to ${p.name}${p.goOn ? " to go on" : ""}? You do it on ${p.name}'s own page.`,
    es: (p) =>
      `¿Inicias sesión en ${p.name}${p.goOn ? " para seguir" : ""}? Se hace en la página de ${p.name}.`,
    ca: (p) =>
      `Inicies sessió a ${p.name}${p.goOn ? " per continuar" : ""}? Es fa a la pàgina de ${p.name}.`,
    fr: (p) =>
      `Vous connecter à ${p.name}${p.goOn ? " pour continuer" : ""} ? Cela se fait sur la page de ${p.name}.`,
  }),
  writeAsk: line<Name & { request?: string | undefined }>({
    en: (p) =>
      p.request
        ? `Ask ${p.name} for change permission to go on with ${q("en", p.request)}? ${p.name}'s page opens again, and nothing changes until you approve the change itself.`
        : `Ask ${p.name} for change permission? ${p.name}'s page opens again, and nothing changes until you approve the change itself.`,
    es: (p) =>
      p.request
        ? `¿Pido a ${p.name} permiso para hacer cambios y seguir con ${q("es", p.request)}? Se vuelve a abrir la página de ${p.name}, y nada cambia hasta que apruebes el cambio en sí.`
        : `¿Pido a ${p.name} permiso para hacer cambios? Se vuelve a abrir la página de ${p.name}, y nada cambia hasta que apruebes el cambio en sí.`,
    ca: (p) =>
      p.request
        ? `Demano a ${p.name} permís per fer canvis i continuar amb ${q("ca", p.request)}? Es torna a obrir la pàgina de ${p.name}, i res no canvia fins que aprovis el canvi.`
        : `Demano a ${p.name} permís per fer canvis? Es torna a obrir la pàgina de ${p.name}, i res no canvia fins que aprovis el canvi.`,
    fr: (p) =>
      p.request
        ? `Demander à ${p.name} l'autorisation de faire des modifications pour continuer ${q("fr", p.request)} ? La page de ${p.name} s'ouvre à nouveau, et rien ne change tant que vous n'avez pas approuvé la modification elle-même.`
        : `Demander à ${p.name} l'autorisation de faire des modifications ? La page de ${p.name} s'ouvre à nouveau, et rien ne change tant que vous n'avez pas approuvé la modification elle-même.`,
  }),
  writeAskSpoken: line<Name & { goOn: boolean }>({
    en: (p) =>
      `Ask ${p.name} for change permission${p.goOn ? " to go on" : ""}? Nothing changes until you approve the change itself.`,
    es: (p) =>
      `¿Pido a ${p.name} permiso para hacer cambios${p.goOn ? " y seguir" : ""}? Nada cambia hasta que apruebes el cambio en sí.`,
    ca: (p) =>
      `Demano a ${p.name} permís per fer canvis${p.goOn ? " i continuar" : ""}? Res no canvia fins que aprovis el canvi.`,
    fr: (p) =>
      `Demander à ${p.name} l'autorisation de modifier${p.goOn ? " pour continuer" : ""} ? Rien ne change tant que vous n'avez pas approuvé la modification.`,
  }),
  signInOpen: line<Name & { write: boolean }>({
    en: (p) =>
      `Use the button below to open ${p.name}'s own page and ${p.write ? "give the change permission" : "sign in, read only"}. I never see your password.`,
    es: (p) =>
      `Usa el botón de abajo para abrir la página de ${p.name} y ${p.write ? "dar el permiso para hacer cambios" : "iniciar sesión, solo lectura"}. Nunca veo tu contraseña.`,
    ca: (p) =>
      `Fes servir el botó de sota per obrir la pàgina de ${p.name} i ${p.write ? "donar el permís per fer canvis" : "iniciar sessió, només de lectura"}. Mai no veig la teva contrasenya.`,
    fr: (p) =>
      `Utilisez le bouton ci-dessous pour ouvrir la page de ${p.name} et ${p.write ? "donner l'autorisation de faire des modifications" : "vous connecter, en lecture seule"}. Je ne vois jamais votre mot de passe.`,
  }),
  signInTabOpen: line<Name & { write: boolean }>({
    en: (p) =>
      `${p.name}'s own page is open in a new tab${p.write ? " for the change permission" : ""}. Sign in there; I never see your password.`,
    es: (p) =>
      `La página de ${p.name} está abierta en una pestaña nueva${p.write ? " para el permiso de cambios" : ""}. Inicia sesión allí; nunca veo tu contraseña.`,
    ca: (p) =>
      `La pàgina de ${p.name} és oberta en una pestanya nova${p.write ? " per al permís de canvis" : ""}. Inicia-hi sessió; mai no veig la teva contrasenya.`,
    fr: (p) =>
      `La page de ${p.name} est ouverte dans un nouvel onglet${p.write ? " pour l'autorisation de modifier" : ""}. Connectez-vous là-bas ; je ne vois jamais votre mot de passe.`,
  }),
  signInTabBlocked: line<Name>({
    en: (p) =>
      `Your browser didn't open ${p.name}'s page in a new tab. Open it with the link below to sign in; I never see your password.`,
    es: (p) =>
      `Tu navegador no ha abierto la página de ${p.name} en una pestaña nueva. Ábrela con el enlace de abajo para iniciar sesión; nunca veo tu contraseña.`,
    ca: (p) =>
      `El teu navegador no ha obert la pàgina de ${p.name} en una pestanya nova. Obre-la amb l'enllaç de sota per iniciar sessió; mai no veig la teva contrasenya.`,
    fr: (p) =>
      `Votre navigateur n'a pas ouvert la page de ${p.name} dans un nouvel onglet. Ouvrez-la avec le lien ci-dessous pour vous connecter ; je ne vois jamais votre mot de passe.`,
  }),
  signInLink: line<Name>({
    en: (p) => `Open ${p.name}'s sign-in page`,
    es: (p) => `Abrir la página de inicio de sesión de ${p.name}`,
    ca: (p) => `Obrir la pàgina d'inici de sessió de ${p.name}`,
    fr: (p) => `Ouvrir la page de connexion de ${p.name}`,
  }),
  resumeAsk: line<Name & { request: string }>({
    en: (p) =>
      `You're signed in at ${p.name}. Shall I go on with ${q("en", p.request)}?`,
    es: (p) =>
      `Ya has iniciado sesión en ${p.name}. ¿Sigo con ${q("es", p.request)}?`,
    ca: (p) =>
      `Ja has iniciat sessió a ${p.name}. Continuo amb ${q("ca", p.request)}?`,
    fr: (p) =>
      `La connexion à ${p.name} est faite. Je continue ${q("fr", p.request)} ?`,
  }),
  earlierSignIn: line<Name>({
    en: (p) => `From your earlier sign-in at ${p.name}`,
    es: (p) => `De tu sesión anterior en ${p.name}`,
    ca: (p) => `De la teva sessió anterior a ${p.name}`,
    fr: (p) => `De votre connexion précédente chez ${p.name}`,
  }),
  resumeAskSpoken: line<Name>({
    en: (p) =>
      `You're signed in at ${p.name}. Shall I go on with your request?`,
    es: (p) => `Ya has iniciado sesión en ${p.name}. ¿Sigo con tu petición?`,
    ca: (p) =>
      `Ja has iniciat sessió a ${p.name}. Continuo amb la teva petició?`,
    fr: (p) =>
      `La connexion à ${p.name} est faite. Je continue votre demande ?`,
  }),
  stayedSignedOut: line<Name & { waited?: string | undefined }>({
    en: (p) =>
      `OK. You stay signed out at ${p.name}${p.waited ? `, and I haven't asked it for ${q("en", p.waited)}` : ""}.`,
    es: (p) =>
      `De acuerdo. Sigues sin sesión en ${p.name}${p.waited ? ` y no le he pedido ${q("es", p.waited)}` : ""}.`,
    ca: (p) =>
      `D'acord. Continues sense sessió a ${p.name}${p.waited ? ` i no li he demanat ${q("ca", p.waited)}` : ""}.`,
    fr: (p) =>
      `D'accord, pas de connexion à ${p.name}${p.waited ? `, et je ne lui ai pas demandé ${q("fr", p.waited)}` : ""}.`,
  }),
  accessUnchanged: line<Name & { waited?: string | undefined }>({
    en: (p) =>
      `OK. Your access at ${p.name} stays as it is${p.waited ? `, and I haven't asked it for ${q("en", p.waited)}` : ""}.`,
    es: (p) =>
      `De acuerdo. Tu acceso en ${p.name} sigue igual${p.waited ? ` y no le he pedido ${q("es", p.waited)}` : ""}.`,
    ca: (p) =>
      `D'acord. El teu accés a ${p.name} es queda igual${p.waited ? ` i no li he demanat ${q("ca", p.waited)}` : ""}.`,
    fr: (p) =>
      `D'accord. Votre accès chez ${p.name} reste tel quel${p.waited ? `, et je ne lui ai pas demandé ${q("fr", p.waited)}` : ""}.`,
  }),
  didntResume: line<Name & { waited?: string | undefined }>({
    en: (p) =>
      p.waited
        ? `OK. I haven't asked ${p.name} for ${q("en", p.waited)}.`
        : `OK. I haven't asked ${p.name} anything.`,
    es: (p) =>
      p.waited
        ? `De acuerdo. No le he pedido ${q("es", p.waited)} a ${p.name}.`
        : `De acuerdo. No le he pedido nada a ${p.name}.`,
    ca: (p) =>
      p.waited
        ? `D'acord. No he demanat ${q("ca", p.waited)} a ${p.name}.`
        : `D'acord. No he demanat res a ${p.name}.`,
    fr: (p) =>
      p.waited
        ? `D'accord. Je n'ai pas demandé ${q("fr", p.waited)} à ${p.name}.`
        : `D'accord. Je n'ai rien demandé à ${p.name}.`,
  }),
  nothingToResume: line<{ name?: string | undefined }>({
    en: (p) =>
      `There's no request waiting${p.name ? ` at ${p.name}` : ""} any more. Could you type it again?`,
    es: (p) =>
      `Ya no hay ninguna petición esperando${p.name ? ` en ${p.name}` : ""}. ¿Puedes escribirla de nuevo?`,
    ca: (p) =>
      `Ja no hi ha cap petició esperant${p.name ? ` a ${p.name}` : ""}. La pots tornar a escriure?`,
    fr: (p) =>
      `Plus aucune demande n'attend${p.name ? ` chez ${p.name}` : ""}. Pouvez-vous la retaper ?`,
  }),
  notConnectedAnyMore: line<Name>({
    en: (p) =>
      `This conversation isn't connected to ${p.name} any more, so there's nothing to sign in to.`,
    es: (p) =>
      `Esta conversación ya no está conectada a ${p.name}, así que no hay dónde iniciar sesión.`,
    ca: (p) =>
      `Aquesta conversa ja no està connectada a ${p.name}, així que no hi ha on iniciar sessió.`,
    fr: (p) =>
      `Cette conversation n'est plus connectée à ${p.name}, il n'y a donc rien où se connecter.`,
  }),
  noSignInOffered: line<Names>({
    en: (p) =>
      `${list("en", p.names)} ${p.names.length > 1 ? "don't" : "doesn't"} offer sign-in to agents like me.`,
    es: (p) =>
      `${list("es", p.names)} no ${p.names.length > 1 ? "ofrecen" : "ofrece"} inicio de sesión a agentes como yo.`,
    ca: (p) =>
      `${list("ca", p.names)} no ${p.names.length > 1 ? "ofereixen" : "ofereix"} inici de sessió a agents com jo.`,
    fr: (p) =>
      `${list("fr", p.names)} ne ${p.names.length > 1 ? "proposent" : "propose"} pas de connexion aux agents comme moi.`,
  }),
  alreadySignedIn: line<Name>({
    en: (p) => `You're already signed in at ${p.name}.`,
    es: (p) => `Ya tienes la sesión iniciada en ${p.name}.`,
    ca: (p) => `Ja tens la sessió iniciada a ${p.name}.`,
    fr: (p) => `Votre session chez ${p.name} est déjà active.`,
  }),
  whichSignIn: line<Names>({
    en: (p) =>
      `Which company do you want to sign in to: ${list("en", p.names, "or")}?`,
    es: (p) =>
      `¿En qué empresa quieres iniciar sesión: ${list("es", p.names, "or")}?`,
    ca: (p) =>
      `A quina empresa vols iniciar sessió: ${list("ca", p.names, "or")}?`,
    fr: (p) =>
      `À quelle entreprise voulez-vous vous connecter : ${list("fr", p.names, "or")} ?`,
  }),
  nothingToSignIn: line({
    en: () => "There's no company in this conversation to sign in to.",
    es: () =>
      "No hay ninguna empresa en esta conversación donde iniciar sesión.",
    ca: () => "No hi ha cap empresa en aquesta conversa on iniciar sessió.",
    fr: () =>
      "Il n'y a aucune entreprise dans cette conversation où se connecter.",
  }),
  noCompanyYet: line({
    en: () =>
      "This conversation isn't connected to a company yet. Connect one first.",
    es: () =>
      "Esta conversación aún no está conectada a ninguna empresa. Conecta una primero.",
    ca: () =>
      "Aquesta conversa encara no està connectada a cap empresa. Connecta'n una primer.",
    fr: () =>
      "Cette conversation n'est encore connectée à aucune entreprise. Connectez-en une d'abord.",
  }),

  // ── Sign-out ───────────────────────────────────────────────────────
  notSignedIn: line<Names>({
    en: (p) => `You aren't signed in at ${list("en", p.names, "or")}.`,
    es: (p) => `No tienes la sesión iniciada en ${list("es", p.names, "or")}.`,
    ca: (p) => `No tens la sessió iniciada a ${list("ca", p.names, "or")}.`,
    fr: (p) =>
      `Vous n'avez pas de session active chez ${list("fr", p.names, "or")}.`,
  }),
  notSignedInAnywhere: line({
    en: () => "You aren't signed in at any company in this conversation.",
    es: () =>
      "No tienes la sesión iniciada en ninguna empresa de esta conversación.",
    ca: () => "No tens la sessió iniciada a cap empresa d'aquesta conversa.",
    fr: () =>
      "Vous n'avez de session active chez aucune entreprise de cette conversation.",
  }),
  whichSignOut: line<Names>({
    en: (p) =>
      `Which company do you want to sign out of: ${list("en", p.names, "or")}?`,
    es: (p) =>
      `¿En qué empresa quieres cerrar la sesión: ${list("es", p.names, "or")}?`,
    ca: (p) =>
      `A quina empresa vols tancar la sessió: ${list("ca", p.names, "or")}?`,
    fr: (p) =>
      `De quelle entreprise voulez-vous vous déconnecter : ${list("fr", p.names, "or")} ?`,
  }),
  signOutAsk: line<Name>({
    en: (p) =>
      `Sign out of ${p.name}? That revokes the access you gave me there, and what I read with your account will be gone from here.`,
    es: (p) =>
      `¿Cierro tu sesión en ${p.name}? Eso revoca el acceso que me diste allí, y lo que leí con tu cuenta desaparecerá de aquí.`,
    ca: (p) =>
      `Tanco la teva sessió a ${p.name}? Això revoca l'accés que em vas donar allà, i el que vaig llegir amb el teu compte desapareixerà d'aquí.`,
    fr: (p) =>
      `Fermer votre session chez ${p.name} ? Cela révoque l'accès que vous m'avez donné là-bas, et ce que j'ai lu avec votre compte disparaîtra d'ici.`,
  }),
  signOutAskSpoken: line<Name>({
    en: (p) => `Sign out of ${p.name}? What I read there will be gone.`,
    es: (p) => `¿Cierro tu sesión en ${p.name}? Lo que leí allí desaparecerá.`,
    ca: (p) =>
      `Tanco la teva sessió a ${p.name}? El que hi vaig llegir desapareixerà.`,
    fr: (p) =>
      `Fermer votre session chez ${p.name} ? Ce que j'y ai lu disparaîtra.`,
  }),
  signedOut: line<Name>({
    en: (p) =>
      `Done, you're signed out of ${p.name}. The access you gave me there is revoked, and what I read with your account is gone from here.`,
    es: (p) =>
      `Hecho, has cerrado la sesión en ${p.name}. El acceso que me diste allí está revocado, y lo que leí con tu cuenta ya no aparece aquí.`,
    ca: (p) =>
      `Fet, has tancat la sessió a ${p.name}. L'accés que em vas donar allà està revocat, i el que vaig llegir amb el teu compte ja no apareix aquí.`,
    fr: (p) =>
      `C'est fait, la session chez ${p.name} est fermée. L'accès que vous m'aviez donné là-bas est révoqué, et ce que j'ai lu avec votre compte n'apparaît plus ici.`,
  }),
  signOutFailed: line<Name>({
    en: (p) => `I couldn't sign you out of ${p.name}. Try again in a moment.`,
    es: (p) =>
      `No he podido cerrar tu sesión en ${p.name}. Vuelve a intentarlo en un momento.`,
    ca: (p) =>
      `No he pogut tancar la teva sessió a ${p.name}. Torna-ho a provar d'aquí a una estona.`,
    fr: (p) =>
      `Je n'ai pas pu fermer votre session chez ${p.name}. Réessayez dans un instant.`,
  }),
  stayedSignedIn: line<Names>({
    en: (p) =>
      `OK, you stay signed in at ${list("en", p.names)}. Nothing was revoked.`,
    es: (p) =>
      `De acuerdo, sigues con la sesión iniciada en ${list("es", p.names)}. No se ha revocado nada.`,
    ca: (p) =>
      `D'acord, continues amb la sessió iniciada a ${list("ca", p.names)}. No s'ha revocat res.`,
    fr: (p) =>
      `D'accord, votre session chez ${list("fr", p.names)} reste active. Rien n'a été révoqué.`,
  }),

  // ── A Company's invitation to talk directly ────────────────────────
  invitationAsk: line<Name>({
    en: (p) =>
      `${p.name} would like to talk with you directly. I won't read or answer there, and you can leave at any time. Talk with ${p.name}?`,
    es: (p) =>
      `${p.name} quiere hablar contigo directamente. Yo no leo ni respondo ahí, y puedes salir cuando quieras. ¿Hablas con ${p.name}?`,
    ca: (p) =>
      `${p.name} vol parlar amb tu directament. Jo no hi llegeixo ni hi responc, i en pots sortir quan vulguis. Parles amb ${p.name}?`,
    fr: (p) =>
      `${p.name} souhaite vous parler directement. Je ne lis ni ne réponds là-bas, et vous pouvez partir à tout moment. Parler avec ${p.name} ?`,
  }),
  invitationAskSpoken: line<Name>({
    en: (p) =>
      `${p.name} would like to talk with you directly. Talk with them?`,
    es: (p) =>
      `${p.name} quiere hablar contigo directamente. ¿Hablas con ellos?`,
    ca: (p) => `${p.name} vol parlar amb tu directament. Hi parles?`,
    fr: (p) => `${p.name} souhaite vous parler directement. Lui parler ?`,
  }),
  invitationGone: line<Name>({
    en: (p) => `${p.name} no longer asks to talk with you directly.`,
    es: (p) => `${p.name} ya no pide hablar contigo directamente.`,
    ca: (p) => `${p.name} ja no demana parlar amb tu directament.`,
    fr: (p) => `${p.name} ne demande plus à vous parler directement.`,
  }),
  directOpen: line<Name>({
    en: (p) =>
      `You're talking with ${p.name} directly now. I don't read or answer here: what you type goes to ${p.name} as your own words.`,
    es: (p) =>
      `Ahora hablas directamente con ${p.name}. Aquí no leo ni respondo: lo que escribas le llega a ${p.name} como tus propias palabras.`,
    ca: (p) =>
      `Ara parles directament amb ${p.name}. Aquí no llegeixo ni responc: el que escriguis li arriba a ${p.name} com a paraules teves.`,
    fr: (p) =>
      `Vous parlez maintenant directement avec ${p.name}. Je ne lis ni ne réponds ici : ce que vous tapez arrive à ${p.name} comme vos propres mots.`,
  }),
  directDeclined: line<Name>({
    en: (p) => `I told ${p.name} you can't talk directly right now.`,
    es: (p) =>
      `Le he dicho a ${p.name} que ahora no puedes hablar directamente.`,
    ca: (p) => `He dit a ${p.name} que ara no pots parlar directament.`,
    fr: (p) =>
      `J'ai dit à ${p.name} que vous ne pouvez pas parler directement pour le moment.`,
  }),
  directClosed: line<Name>({
    en: (p) => `You've left the direct conversation with ${p.name}. I'm back.`,
    es: (p) =>
      `Has salido de la conversación directa con ${p.name}. Ya estoy aquí otra vez.`,
    ca: (p) =>
      `Has sortit de la conversa directa amb ${p.name}. Ja torno a ser aquí.`,
    fr: (p) =>
      `Vous avez quitté la conversation directe avec ${p.name}. Je suis de retour.`,
  }),

  // ── Decisions on a proposal ────────────────────────────────────────
  proposalGone: line<{ what: string } & Done>({
    en: (p) =>
      `${capital(p.what)} isn't here any more, so nothing was ${done.en(p)}.`,
    es: (p) =>
      `${capital(p.what)} ya no está aquí, así que no se ha ${done.es(p)} nada.`,
    ca: (p) =>
      `${capital(p.what)} ja no hi és, així que no s'ha ${done.ca(p)} res.`,
    fr: (p) =>
      `${capital(p.what)} n'est plus là, donc rien n'a été ${done.fr(p)}.`,
  }),
  termsChanged: line<Name & Done>({
    en: (p) =>
      `${p.name} changed the terms after I asked, so nothing was ${done.en(p)}.`,
    es: (p) =>
      `${p.name} ha cambiado las condiciones después de preguntarte, así que no se ha ${done.es(p)} nada.`,
    ca: (p) =>
      `${p.name} ha canviat les condicions després de preguntar-t'ho, així que no s'ha ${done.ca(p)} res.`,
    fr: (p) =>
      `${p.name} a modifié les conditions après ma question, donc rien n'a été ${done.fr(p)}.`,
  }),
  performed: line<Name & { what: string }>({
    en: (p) => `Done. You approved ${p.what}, and it has been carried out.`,
    es: (p) => `Hecho. Has aprobado ${p.what} y ya está hecho.`,
    ca: (p) => `Fet. Has aprovat ${p.what} i ja està fet.`,
    fr: (p) =>
      `C'est fait. Vous avez approuvé ${p.what}, et c'est chose faite.`,
  }),
  changeReady: line({
    en: () => "I asked for the change, and here it is.",
    es: () => "He pedido el cambio, y aquí lo tienes.",
    ca: () => "He demanat el canvi, i aquí el tens.",
    fr: () => "J'ai demandé la modification, la voici.",
  }),
  approvedOnInstruction: line<{ what: string }>({
    en: (p) =>
      `Your standing instruction covers ${p.what}, so I approved it for you.`,
    es: (p) =>
      `Tu instrucción permanente cubre ${p.what}, así que he dado la aprobación por ti.`,
    ca: (p) =>
      `La teva instrucció permanent cobreix ${p.what}, així que he donat l'aprovació per tu.`,
    fr: (p) =>
      `Votre instruction permanente couvre ${p.what}, j'ai donc donné l'approbation pour vous.`,
  }),
  approvalRefused: line<Name>({
    en: (p) => `${p.name} declined the approval and did nothing.`,
    es: (p) => `${p.name} ha rechazado la aprobación y no ha hecho nada.`,
    ca: (p) => `${p.name} ha rebutjat l'aprovació i no ha fet res.`,
    fr: (p) => `${p.name} a refusé l'approbation et n'a rien fait.`,
  }),
  declined: line<Name>({
    en: (p) =>
      `Declined. I sent no approval to ${p.name}, and nothing was done.`,
    es: (p) =>
      `Rechazado. No he enviado ninguna aprobación a ${p.name} y no se ha hecho nada.`,
    ca: (p) =>
      `Rebutjat. No he enviat cap aprovació a ${p.name} i no s'ha fet res.`,
    fr: (p) =>
      `Refusé. Je n'ai envoyé aucune approbation à ${p.name}, et rien n'a été fait.`,
  }),
  notSent: line<Name & Done>({
    en: (p) =>
      `I couldn't send that to ${p.name}, so nothing was ${done.en(p)}. Try again in a moment.`,
    es: (p) =>
      `No he podido enviárselo a ${p.name}, así que no se ha ${done.es(p)} nada. Vuelve a intentarlo en un momento.`,
    ca: (p) =>
      `No ho he pogut enviar a ${p.name}, així que no s'ha ${done.ca(p)} res. Torna-ho a provar d'aquí a una estona.`,
    fr: (p) =>
      `Je n'ai pas pu l'envoyer à ${p.name}, donc rien n'a été ${done.fr(p)}. Réessayez dans un instant.`,
  }),
  stillWaitsOne: line<{ what: string }>({
    en: (p) =>
      `${capital(p.what)} is still waiting for you. Shall I approve that one too?`,
    es: (p) => `${capital(p.what)} sigue esperándote. ¿Lo apruebo también?`,
    ca: (p) => `${capital(p.what)} encara t'espera. També l'aprovo?`,
    fr: (p) => `${capital(p.what)} vous attend encore. Je l'approuve aussi ?`,
  }),
  stillWaitMany: line<Names>({
    en: (p) =>
      `${capital(list("en", p.names))} are still waiting for you. Which one should I approve: ${list("en", p.names, "or")}?`,
    es: (p) =>
      `Siguen esperándote ${list("es", p.names)}. ¿Cuál apruebo: ${list("es", p.names, "or")}?`,
    ca: (p) =>
      `Encara t'esperen ${list("ca", p.names)}. Quina aprovo: ${list("ca", p.names, "or")}?`,
    fr: (p) =>
      `${capital(list("fr", p.names))} vous attendent encore. Laquelle dois-je approuver : ${list("fr", p.names, "or")} ?`,
  }),
  alreadyApproved: line<Name & { what: string; byAgent: boolean }>({
    en: (p) =>
      p.byAgent
        ? `I already approved ${p.what} on your standing instruction, and it has been carried out. I sent nothing more.`
        : `${capital(p.what)} was already approved, and it has been carried out. I sent nothing more.`,
    es: (p) =>
      p.byAgent
        ? `Ya aprobé ${p.what} según tu instrucción permanente y ya está hecho. No he enviado nada más.`
        : `Ya se había aprobado ${p.what} y ya está hecho. No he enviado nada más.`,
    ca: (p) =>
      p.byAgent
        ? `Ja havia aprovat ${p.what} segons la teva instrucció permanent i ja està fet. No he enviat res més.`
        : `Ja s'havia aprovat ${p.what} i ja està fet. No he enviat res més.`,
    fr: (p) =>
      p.byAgent
        ? `J'avais déjà approuvé ${p.what} selon votre instruction permanente, et c'est chose faite. Je n'ai rien envoyé de plus.`
        : `L'approbation de ${p.what} était déjà faite, et c'est chose faite. Je n'ai rien envoyé de plus.`,
  }),
  alreadyDeclined: line<Name & { what: string }>({
    en: (p) => `You already declined ${p.what}, so I sent nothing.`,
    es: (p) => `Ya rechazaste ${p.what}, así que no he enviado nada.`,
    ca: (p) => `Ja vas rebutjar ${p.what}, així que no he enviat res.`,
    fr: (p) => `Vous aviez déjà refusé ${p.what}, donc je n'ai rien envoyé.`,
  }),
  outcomeUnknown: line<Name & { what: string }>({
    en: (p) =>
      `${capital(p.what)} was approved, but there's no word yet on whether it was carried out. Retry the same approval on its card; I sent nothing new.`,
    es: (p) =>
      `Se aprobó ${p.what}, pero aún no se sabe si se ha llevado a cabo. Reintenta la misma aprobación desde su tarjeta; no he enviado nada nuevo.`,
    ca: (p) =>
      `Es va aprovar ${p.what}, però encara no se sap si s'ha fet. Torna a provar la mateixa aprovació des de la seva targeta; no he enviat res de nou.`,
    fr: (p) =>
      `L'approbation de ${p.what} a été envoyée, mais on ne sait pas encore si c'est fait. Relancez la même approbation depuis sa carte ; je n'ai rien envoyé de nouveau.`,
  }),
  expired: line<{ what: string } & Done>({
    en: (p) =>
      `${capital(p.what)} has expired, so nothing was ${done.en(p)}. Ask for the change again to get new terms.`,
    es: (p) =>
      `${capital(p.what)} ha caducado, así que no se ha ${done.es(p)} nada. Vuelve a pedir el cambio para recibir condiciones nuevas.`,
    ca: (p) =>
      `${capital(p.what)} ha caducat, així que no s'ha ${done.ca(p)} res. Torna a demanar el canvi per rebre condicions noves.`,
    fr: (p) =>
      `${capital(p.what)} a expiré, donc rien n'a été ${done.fr(p)}. Redemandez la modification pour recevoir de nouvelles conditions.`,
  }),
  noLongerWaits: line<{ what: string } & Done>({
    en: (p) =>
      `${capital(p.what)} no longer waits for an answer, so nothing was ${done.en(p)}.`,
    es: (p) =>
      `${capital(p.what)} ya no espera respuesta, así que no se ha ${done.es(p)} nada.`,
    ca: (p) =>
      `${capital(p.what)} ja no espera resposta, així que no s'ha ${done.ca(p)} res.`,
    fr: (p) =>
      `${capital(p.what)} n'attend plus de réponse, donc rien n'a été ${done.fr(p)}.`,
  }),

  // ── The conversation's Companies ───────────────────────────────────
  labCompanies: line<Names>({
    en: (p) =>
      `The lab's companies are ${list("en", p.names)}. To connect another company, type its address in the address box.`,
    es: (p) =>
      `Las empresas del laboratorio son ${list("es", p.names)}. Para conectar otra, escribe su dirección en el cuadro de dirección.`,
    ca: (p) =>
      `Les empreses del laboratori són ${list("ca", p.names)}. Per connectar-ne una altra, escriu-ne l'adreça al quadre d'adreça.`,
    fr: (p) =>
      `Les entreprises du laboratoire sont ${list("fr", p.names)}. Pour en connecter une autre, tapez son adresse dans la barre d'adresse.`,
  }),
  whichOneMeant: line<Names>({
    en: (p) => `Which one do you mean: ${list("en", p.names, "or")}?`,
    es: (p) => `¿Cuál quieres decir: ${list("es", p.names, "or")}?`,
    ca: (p) => `Quina vols dir: ${list("ca", p.names, "or")}?`,
    fr: (p) => `Laquelle voulez-vous dire : ${list("fr", p.names, "or")} ?`,
  }),
  noSuchLabCompany: line<{ named?: string | undefined }>({
    en: (p) =>
      p.named
        ? `The lab has no company called ${q("en", p.named)}.`
        : "Which company?",
    es: (p) =>
      p.named
        ? `El laboratorio no tiene ninguna empresa llamada ${q("es", p.named)}.`
        : "¿Qué empresa?",
    ca: (p) =>
      p.named
        ? `El laboratori no té cap empresa anomenada ${q("ca", p.named)}.`
        : "Quina empresa?",
    fr: (p) =>
      p.named
        ? `Le laboratoire n'a aucune entreprise nommée ${q("fr", p.named)}.`
        : "Quelle entreprise ?",
  }),
  noSuchConnected: line<{ named: string } & Names>({
    en: (p) =>
      `This conversation isn't connected to a company called ${q("en", p.named)}. ${p.names.length ? `It's connected to ${list("en", p.names)}.` : "It isn't connected to any company."}`,
    es: (p) =>
      `Esta conversación no está conectada a ninguna empresa llamada ${q("es", p.named)}. ${p.names.length ? `Está conectada a ${list("es", p.names)}.` : "No está conectada a ninguna empresa."}`,
    ca: (p) =>
      `Aquesta conversa no està connectada a cap empresa anomenada ${q("ca", p.named)}. ${p.names.length ? `Està connectada a ${list("ca", p.names)}.` : "No està connectada a cap empresa."}`,
    fr: (p) =>
      `Cette conversation n'est connectée à aucune entreprise nommée ${q("fr", p.named)}. ${p.names.length ? `Elle est connectée à ${list("fr", p.names)}.` : "Elle n'est connectée à aucune entreprise."}`,
  }),
  whichToRemove: line<Names>({
    en: (p) =>
      `Which company should I remove? This conversation is connected to ${list("en", p.names)}.`,
    es: (p) =>
      `¿Qué empresa quito? Esta conversación está conectada a ${list("es", p.names)}.`,
    ca: (p) =>
      `Quina empresa trec? Aquesta conversa està connectada a ${list("ca", p.names)}.`,
    fr: (p) =>
      `Quelle entreprise dois-je retirer ? Cette conversation est connectée à ${list("fr", p.names)}.`,
  }),
  noneToRemove: line({
    en: () =>
      "This conversation isn't connected to any company, so there's none to remove.",
    es: () =>
      "Esta conversación no está conectada a ninguna empresa, así que no hay nada que quitar.",
    ca: () =>
      "Aquesta conversa no està connectada a cap empresa, així que no hi ha res a treure.",
    fr: () =>
      "Cette conversation n'est connectée à aucune entreprise, il n'y a donc rien à retirer.",
  }),
  removeAsk: line<Names>({
    en: (p) => `Remove ${list("en", p.names)} from this conversation?`,
    es: (p) => `¿Quito ${list("es", p.names)} de esta conversación?`,
    ca: (p) => `Trec ${list("ca", p.names)} d'aquesta conversa?`,
    fr: (p) => `Je retire ${list("fr", p.names)} de cette conversation ?`,
  }),
  removeRevokes: line<{ at?: readonly string[] | undefined }>({
    en: (p) =>
      `That revokes the access you gave me ${p.at ? `at ${list("en", p.at)}` : "there"}, and what I read with your account will be gone from here.`,
    es: (p) =>
      `Eso revoca el acceso que me diste ${p.at ? `en ${list("es", p.at)}` : "allí"}, y lo que leí con tu cuenta desaparecerá de aquí.`,
    ca: (p) =>
      `Això revoca l'accés que em vas donar ${p.at ? `a ${list("ca", p.at)}` : "allà"}, i el que vaig llegir amb el teu compte desapareixerà d'aquí.`,
    fr: (p) =>
      `Cela révoque l'accès que vous m'avez donné ${p.at ? `chez ${list("fr", p.at)}` : "là-bas"}, et ce que j'ai lu avec votre compte disparaîtra d'ici.`,
  }),
  removeDropsProposals: line<{ count: number; many: boolean }>({
    en: (p) =>
      `${p.count > 1 ? `${p.count} proposals waiting for your approval go` : "A proposal waiting for your approval goes"} with ${p.many ? "them" : "it"}.`,
    es: (p) =>
      `${p.count > 1 ? `${p.count} propuestas pendientes de tu aprobación se van` : "Una propuesta pendiente de tu aprobación se va"} con ${p.many ? "ellas" : "ella"}.`,
    ca: (p) =>
      `${p.count > 1 ? `${p.count} propostes pendents de la teva aprovació se'n van` : "Una proposta pendent de la teva aprovació se'n va"} amb ${p.many ? "elles" : "ella"}.`,
    fr: (p) =>
      `${p.count > 1 ? `${p.count} propositions en attente de votre approbation partent` : "Une proposition en attente de votre approbation part"} avec ${p.many ? "elles" : "elle"}.`,
  }),
  connectAgainAnyTime: line<{ many: boolean }>({
    en: (p) => `You can connect ${p.many ? "them" : "it"} again at any time.`,
    es: (p) =>
      `Puedes volver a conectar${p.many ? "las" : "la"} cuando quieras.`,
    ca: (p) => `${p.many ? "Les" : "La"} pots tornar a connectar quan vulguis.`,
    fr: (p) =>
      `Vous pouvez ${p.many ? "les" : "la"} reconnecter à tout moment.`,
  }),
  restAfter: line({
    en: () => "I'll ask the rest of your message after that.",
    es: () => "Después pregunto el resto de tu mensaje.",
    ca: () => "Després pregunto la resta del teu missatge.",
    fr: () => "Je poserai ensuite le reste de votre message.",
  }),
  restDropped: line({
    en: () => "I didn't pass the rest of your message to anyone.",
    es: () => "No he pasado el resto de tu mensaje a nadie.",
    ca: () => "No he passat la resta del teu missatge a ningú.",
    fr: () => "Je n'ai transmis le reste de votre message à personne.",
  }),
  kept: line<Names & { revoked: boolean }>({
    en: (p) =>
      `OK, ${list("en", p.names)} ${p.names.length > 1 ? "stay" : "stays"} connected. Nothing was removed${p.revoked ? " or revoked" : ""}.`,
    es: (p) =>
      `De acuerdo, ${list("es", p.names)} ${p.names.length > 1 ? "siguen conectadas" : "sigue conectada"}. No se ha quitado${p.revoked ? " ni revocado" : ""} nada.`,
    ca: (p) =>
      `D'acord, ${list("ca", p.names)} ${p.names.length > 1 ? "continuen connectades" : "continua connectada"}. No s'ha tret${p.revoked ? " ni revocat" : ""} res.`,
    fr: (p) =>
      `D'accord, ${list("fr", p.names)} ${p.names.length > 1 ? "restent connectées" : "reste connectée"}. Rien n'a été retiré${p.revoked ? " ni révoqué" : ""}.`,
  }),
  nothingRemoved: line({
    en: () => "Nothing was removed.",
    es: () => "No se ha quitado nada.",
    ca: () => "No s'ha tret res.",
    fr: () => "Rien n'a été retiré.",
  }),
  connectedFor: line<Name>({
    en: (p) =>
      `That's one for ${p.name}, so I connected it to this conversation. I'm asking without your account until you sign in there.`,
    es: (p) =>
      `Eso es cosa de ${p.name}, así que la he conectado a esta conversación. Pregunto sin tu cuenta hasta que inicies sesión allí.`,
    ca: (p) =>
      `Això és cosa de ${p.name}, així que l'he connectada a aquesta conversa. Pregunto sense el teu compte fins que hi iniciïs sessió.`,
    fr: (p) =>
      `C'est une demande pour ${p.name}, je l'ai donc connectée à cette conversation. Je demande sans votre compte jusqu'à ce que vous vous y connectiez.`,
  }),
  noRoomFor: line<Name & { most: number }>({
    en: (p) =>
      `That's one for ${p.name}, which isn't in this conversation. It already has ${p.most} companies, the most it can hold: remove one, ask again, and I'll connect ${p.name}.`,
    es: (p) =>
      `Eso es cosa de ${p.name}, que no está en esta conversación. Ya tiene ${p.most} empresas, el máximo: quita una, vuelve a preguntar y conecto ${p.name}.`,
    ca: (p) =>
      `Això és cosa de ${p.name}, que no és en aquesta conversa. Ja té ${p.most} empreses, el màxim: treu-ne una, torna a preguntar i connecto ${p.name}.`,
    fr: (p) =>
      `C'est une demande pour ${p.name}, qui n'est pas dans cette conversation. Elle a déjà ${p.most} entreprises, le maximum : retirez-en une, redemandez, et je connecterai ${p.name}.`,
  }),
  alreadyConnected: line<Name>({
    en: (p) => `This conversation is already connected to ${p.name}.`,
    es: (p) => `Esta conversación ya está conectada a ${p.name}.`,
    ca: (p) => `Aquesta conversa ja està connectada a ${p.name}.`,
    fr: (p) => `Cette conversation est déjà connectée à ${p.name}.`,
  }),
  couldntConnect: line<Name & { why?: string | undefined }>({
    en: (p) =>
      `I couldn't connect ${p.name}. ${p.why ?? "It couldn't be reached."}`,
    es: (p) => `No he podido conectar ${p.name}. ${p.why ?? "No responde."}`,
    ca: (p) => `No he pogut connectar ${p.name}. ${p.why ?? "No respon."}`,
    fr: (p) =>
      `Je n'ai pas pu connecter ${p.name}. ${p.why ?? "Elle ne répond pas."}`,
  }),
  connected: line<Names>({
    en: (p) => `I've connected ${list("en", p.names)}.`,
    es: (p) => `He conectado ${list("es", p.names)}.`,
    ca: (p) => `He connectat ${list("ca", p.names)}.`,
    fr: (p) => `J'ai connecté ${list("fr", p.names)}.`,
  }),
  describesOffer: line<{ name?: string | undefined; words: string }>({
    en: (p) =>
      `${p.name ?? "It"} describes what it offers as ${q("en", p.words)}.`,
    es: (p) =>
      `${p.name ?? "La empresa"} describe lo que ofrece así: ${q("es", p.words)}.`,
    ca: (p) =>
      `${p.name ?? "L'empresa"} descriu el que ofereix així: ${q("ca", p.words)}.`,
    fr: (p) =>
      `${p.name ?? "L'entreprise"} décrit son offre ainsi : ${q("fr", p.words)}.`,
  }),
  signInOffered: line<{ many: boolean }>({
    en: (p) =>
      `If a request needs your account ${p.many ? "at one of them" : "there"}, I'll offer you a sign-in.`,
    es: (p) =>
      `Si alguna petición necesita tu cuenta ${p.many ? "en alguna de ellas" : "allí"}, te ofreceré iniciar sesión.`,
    ca: (p) =>
      `Si alguna petició necessita el teu compte ${p.many ? "en alguna d'elles" : "allà"}, t'oferiré iniciar sessió.`,
    fr: (p) =>
      `Si une demande a besoin de votre compte ${p.many ? "chez l'une d'elles" : "là-bas"}, je vous proposerai de vous connecter.`,
  }),
  askNow: line<{ many: boolean }>({
    en: (p) => `You can ask ${p.many ? "them" : "it"} something now.`,
    es: (p) => `Ya puedes preguntar${p.many ? "les" : "le"} algo.`,
    ca: (p) => `Ja ${p.many ? "els" : "li"} pots preguntar alguna cosa.`,
    fr: (p) =>
      `Vous pouvez ${p.many ? "leur" : "lui"} demander quelque chose maintenant.`,
  }),
  notConnectedTo: line<Name>({
    en: (p) => `This conversation isn't connected to ${p.name}.`,
    es: (p) => `Esta conversación no está conectada a ${p.name}.`,
    ca: (p) => `Aquesta conversa no està connectada a ${p.name}.`,
    fr: (p) => `Cette conversation n'est pas connectée à ${p.name}.`,
  }),
  removedRevoked: line<Name>({
    en: (p) =>
      `I've removed ${p.name} from this conversation and revoked the access you gave me there.`,
    es: (p) =>
      `He quitado ${p.name} de esta conversación y he revocado el acceso que me diste allí.`,
    ca: (p) =>
      `He tret ${p.name} d'aquesta conversa i he revocat l'accés que em vas donar allà.`,
    fr: (p) =>
      `J'ai retiré ${p.name} de cette conversation et révoqué l'accès que vous m'aviez donné là-bas.`,
  }),
  removed: line<Name>({
    en: (p) => `I've removed ${p.name} from this conversation.`,
    es: (p) => `He quitado ${p.name} de esta conversación.`,
    ca: (p) => `He tret ${p.name} d'aquesta conversa.`,
    fr: (p) => `J'ai retiré ${p.name} de cette conversation.`,
  }),
  readGone: line({
    en: () => "What I read with your account there is gone from here.",
    es: () => "Lo que leí con tu cuenta allí ya no aparece aquí.",
    ca: () => "El que vaig llegir amb el teu compte allà ja no apareix aquí.",
    fr: () => "Ce que j'ai lu avec votre compte là-bas n'apparaît plus ici.",
  }),
  noCompanyNow: line({
    en: () => "This conversation has no company now. Connect one to go on.",
    es: () =>
      "Ahora esta conversación no tiene ninguna empresa. Conecta una para seguir.",
    ca: () =>
      "Ara aquesta conversa no té cap empresa. Connecta'n una per continuar.",
    fr: () =>
      "Cette conversation n'a plus d'entreprise. Connectez-en une pour continuer.",
  }),

  // ── Which Company a request is for ─────────────────────────────────
  noRequestWaiting: line({
    en: () =>
      "There's no request waiting for a company any more. Could you type it again?",
    es: () =>
      "Ya no hay ninguna petición esperando a que elijas empresa. ¿Puedes escribirla de nuevo?",
    ca: () =>
      "Ja no hi ha cap petició esperant que triïs empresa. La pots tornar a escriure?",
    fr: () =>
      "Plus aucune demande n'attend le choix d'une entreprise. Pouvez-vous la retaper ?",
  }),
  whichIsItFor: line<Names>({
    en: (p) => `Which one is this for: ${list("en", p.names, "or")}?`,
    es: (p) => `¿Para cuál es: ${list("es", p.names, "or")}?`,
    ca: (p) => `Per a quina és: ${list("ca", p.names, "or")}?`,
    fr: (p) => `C'est pour laquelle : ${list("fr", p.names, "or")} ?`,
  }),
  isItFor: line<Names & { why: "none" | "both" | "each" }>({
    en: (p) =>
      `Is this for ${list("en", p.names, "or")}? ${{ none: "Nothing in your message says which.", both: "Both could have what you asked about.", each: "Each of them could have what you asked about." }[p.why]}`,
    es: (p) =>
      `¿Es para ${list("es", p.names, "or")}? ${{ none: "Tu mensaje no dice cuál.", both: "Las dos podrían tener lo que buscas.", each: "Cualquiera de ellas podría tener lo que buscas." }[p.why]}`,
    ca: (p) =>
      `És per a ${list("ca", p.names, "or")}? ${{ none: "El teu missatge no diu quina.", both: "Totes dues podrien tenir el que busques.", each: "Qualsevol d'elles podria tenir el que busques." }[p.why]}`,
    fr: (p) =>
      `C'est pour ${list("fr", p.names, "or")} ? ${{ none: "Votre message ne dit pas laquelle.", both: "Les deux pourraient avoir ce que vous cherchez.", each: "Chacune pourrait avoir ce que vous cherchez." }[p.why]}`,
  }),
  noCompanyToAsk: line<Names>({
    en: (p) =>
      `This conversation has no company yet, so I haven't sent your request anywhere. Connect one first: ${list("en", p.names, "or")} from the lab, or another by typing its address in the address box.`,
    es: (p) =>
      `Esta conversación aún no tiene ninguna empresa, así que no he enviado tu petición a ninguna parte. Conecta una primero: ${list("es", p.names, "or")} del laboratorio, u otra escribiendo su dirección en el cuadro de dirección.`,
    ca: (p) =>
      `Aquesta conversa encara no té cap empresa, així que no he enviat la teva petició enlloc. Connecta'n una primer: ${list("ca", p.names, "or")} del laboratori, o una altra escrivint-ne l'adreça al quadre d'adreça.`,
    fr: (p) =>
      `Cette conversation n'a pas encore d'entreprise, je n'ai donc envoyé votre demande nulle part. Connectez-en une d'abord : ${list("fr", p.names, "or")} du laboratoire, ou une autre en tapant son adresse dans la barre d'adresse.`,
  }),
  needsTwo: line<{
    reads: string;
    pays: string;
    absent: readonly string[];
    have: number;
    /** How many to remove first, when there is no room. */
    remove: number;
  }>({
    en: (p) => {
      const many = p.absent.length > 1;
      const them = many ? "them" : "it";
      return `This needs two companies: ${p.reads}, where I read your bill, and ${p.pays}, where I propose the payment. ${list("en", p.absent)} ${many ? "aren't" : "isn't"} in this conversation yet. ${p.remove ? `It already has ${p.have} companies, so remove ${p.remove > 1 ? `${p.remove} of them` : "one"} first, then connect ${them}, sign in at both and ask again.` : `Connect ${them}, sign in at both and ask again.`} I haven't sent anything to any company.`;
    },
    es: (p) => {
      const many = p.absent.length > 1;
      const them = many ? "conéctalas" : "conéctala";
      return `Esto necesita dos empresas: ${p.reads}, donde leo tu factura, y ${p.pays}, donde propongo el pago. ${list("es", p.absent)} aún no ${many ? "están" : "está"} en esta conversación. ${p.remove ? `Ya tiene ${p.have} empresas, así que quita ${p.remove > 1 ? p.remove : "una"} primero; luego ${them}, inicia sesión en las dos y vuelve a preguntar.` : `${capital(them)}, inicia sesión en las dos y vuelve a preguntar.`} No he enviado nada a ninguna empresa.`;
    },
    ca: (p) => {
      const many = p.absent.length > 1;
      const them = many ? "connecta-les" : "connecta-la";
      return `Això necessita dues empreses: ${p.reads}, on llegeixo la teva factura, i ${p.pays}, on proposo el pagament. ${list("ca", p.absent)} encara no ${many ? "són" : "és"} en aquesta conversa. ${p.remove ? `Ja en té ${p.have}, així que treu-ne ${p.remove > 1 ? p.remove : "una"} primer; després ${them}, inicia sessió a totes dues i torna a preguntar.` : `${capital(them)}, inicia sessió a totes dues i torna a preguntar.`} No he enviat res a cap empresa.`;
    },
    fr: (p) => {
      const many = p.absent.length > 1;
      const them = many ? "connectez-les" : "connectez-la";
      return `Il faut deux entreprises : ${p.reads}, où je lis votre facture, et ${p.pays}, où je propose le paiement. ${list("fr", p.absent)} ${many ? "ne sont" : "n'est"} pas encore dans cette conversation. ${p.remove ? `Elle a déjà ${p.have} entreprises, retirez-en donc ${p.remove > 1 ? p.remove : "une"} d'abord, puis ${them}, connectez-vous aux deux et redemandez.` : `${capital(them)}, connectez-vous aux deux et redemandez.`} Je n'ai rien envoyé à aucune entreprise.`;
    },
  }),

  // ── A turn that failed ─────────────────────────────────────────────
  sessionRefused: line({
    en: () =>
      "The Company refused this signed-out Poppy 1.0 Session. It may implement another version of the protocol; check its discovery in the Inspector.",
    es: () =>
      "La empresa ha rechazado esta sesión de Poppy 1.0 sin cuenta. Puede que implemente otra versión del protocolo; revisa su descubrimiento en el Inspector.",
    ca: () =>
      "L'empresa ha rebutjat aquesta sessió de Poppy 1.0 sense compte. Potser implementa una altra versió del protocol; revisa'n el descobriment a l'Inspector.",
    fr: () =>
      "L'entreprise a refusé cette session Poppy 1.0 sans compte. Elle implémente peut-être une autre version du protocole ; vérifiez sa découverte dans l'Inspector.",
  }),
  signInRequired: line({
    en: () =>
      "That needs your account at the Company, and it didn't take the request without it. Use Sign in in the chat if the Company offers it, then ask again.",
    es: () =>
      "Eso necesita tu cuenta en la empresa, y no ha aceptado la petición sin ella. Usa Iniciar sesión en el chat si la empresa lo ofrece y vuelve a preguntar.",
    ca: () =>
      "Això necessita el teu compte a l'empresa, i no ha acceptat la petició sense. Fes servir Iniciar sessió al xat si l'empresa ho ofereix i torna a preguntar.",
    fr: () =>
      "Cela demande votre compte chez l'entreprise, qui n'a pas accepté la demande sans lui. Utilisez Se connecter dans le chat si l'entreprise le propose, puis redemandez.",
  }),
  companyError: line<{
    name?: string | undefined;
    status: number;
    facts: string;
  }>({
    en: (p) =>
      `${p.name ?? "The Company"} answered HTTP ${p.status}${p.facts}. I didn't retry anything; see the Inspector.`,
    es: (p) =>
      `${p.name ?? "La empresa"} ha respondido HTTP ${p.status}${p.facts}. No he reintentado nada; mira el Inspector.`,
    ca: (p) =>
      `${p.name ?? "L'empresa"} ha respost HTTP ${p.status}${p.facts}. No he tornat a provar res; mira l'Inspector.`,
    fr: (p) =>
      `${p.name ?? "L'entreprise"} a répondu HTTP ${p.status}${p.facts}. Je n'ai rien relancé ; voyez l'Inspector.`,
  }),
  chatFailed: line({
    en: () =>
      "That didn't go through. Check the Company is running and the selected provider is configured, or try Protocol demo.",
    es: () =>
      "No ha funcionado. Comprueba que la empresa está en marcha y que el proveedor elegido está configurado, o prueba Protocol demo.",
    ca: () =>
      "No ha funcionat. Comprova que l'empresa funciona i que el proveïdor triat està configurat, o prova Protocol demo.",
    fr: () =>
      "Cela n'a pas abouti. Vérifiez que l'entreprise fonctionne et que le fournisseur choisi est configuré, ou essayez Protocol demo.",
  }),

  // ── The free model, when a turn runs in demo mode instead ──────────
  freeModel: line<{
    why:
      | "notDeployed"
      | "off"
      | "allowance"
      | "unfinished"
      | "failed"
      | "hour"
      | "day"
      | "network";
    count?: number | undefined;
  }>({
    en: (p) => {
      const demo = "so this turn ran in demo mode, with guided examples";
      return {
        notDeployed: `The free model runs only on the deployed site, ${demo}.`,
        off: `The free model is off on this deployment, ${demo}.`,
        allowance: `The free model has used today's allowance for everyone, ${demo}. It starts again at midnight UTC, or you can use your own model.`,
        unfinished: `The browser check for the free model hadn't finished, ${demo}. Send it again in a moment.`,
        failed: `Cloudflare's browser check didn't pass, ${demo}. Send it again in a moment.`,
        hour: `You've used the free model's ${p.count} turns for this hour, ${demo}. Try again later, or use your own model.`,
        day: `You've used the free model's ${p.count} turns for today, ${demo}. Try again tomorrow, or use your own model.`,
        network: `Visitors on your network have used the free model's turns for now, ${demo}. Try again later, or use your own model.`,
      }[p.why];
    },
    es: (p) => {
      const demo =
        "así que este turno ha ido en modo demo, con ejemplos guiados";
      return {
        notDeployed: `El modelo gratuito solo funciona en el sitio publicado, ${demo}.`,
        off: `El modelo gratuito está desactivado en este despliegue, ${demo}.`,
        allowance: `El modelo gratuito ha agotado la cuota de hoy para todos, ${demo}. Vuelve a medianoche UTC, o puedes usar tu propio modelo.`,
        unfinished: `La comprobación del navegador para el modelo gratuito no había terminado, ${demo}. Vuelve a enviarlo en un momento.`,
        failed: `La comprobación del navegador de Cloudflare no se ha superado, ${demo}. Vuelve a enviarlo en un momento.`,
        hour: `Has usado los ${p.count} turnos del modelo gratuito de esta hora, ${demo}. Prueba más tarde, o usa tu propio modelo.`,
        day: `Has usado los ${p.count} turnos del modelo gratuito de hoy, ${demo}. Prueba mañana, o usa tu propio modelo.`,
        network: `Otros visitantes de tu red han usado los turnos del modelo gratuito por ahora, ${demo}. Prueba más tarde, o usa tu propio modelo.`,
      }[p.why];
    },
    ca: (p) => {
      const demo =
        "així que aquest torn ha anat en mode demo, amb exemples guiats";
      return {
        notDeployed: `El model gratuït només funciona al lloc publicat, ${demo}.`,
        off: `El model gratuït està desactivat en aquest desplegament, ${demo}.`,
        allowance: `El model gratuït ha esgotat la quota d'avui per a tothom, ${demo}. Torna a mitjanit UTC, o pots fer servir el teu propi model.`,
        unfinished: `La comprovació del navegador per al model gratuït no havia acabat, ${demo}. Torna-ho a enviar d'aquí a una estona.`,
        failed: `La comprovació del navegador de Cloudflare no s'ha superat, ${demo}. Torna-ho a enviar d'aquí a una estona.`,
        hour: `Has fet servir els ${p.count} torns del model gratuït d'aquesta hora, ${demo}. Prova-ho més tard, o fes servir el teu propi model.`,
        day: `Has fet servir els ${p.count} torns del model gratuït d'avui, ${demo}. Prova-ho demà, o fes servir el teu propi model.`,
        network: `Altres visitants de la teva xarxa han fet servir els torns del model gratuït de moment, ${demo}. Prova-ho més tard, o fes servir el teu propi model.`,
      }[p.why];
    },
    fr: (p) => {
      const demo =
        "ce tour s'est donc déroulé en mode démo, avec des exemples guidés";
      return {
        notDeployed: `Le modèle gratuit ne fonctionne que sur le site déployé, ${demo}.`,
        off: `Le modèle gratuit est désactivé sur ce déploiement, ${demo}.`,
        allowance: `Le modèle gratuit a épuisé le quota du jour pour tout le monde, ${demo}. Il revient à minuit UTC, ou vous pouvez utiliser votre propre modèle.`,
        unfinished: `La vérification du navigateur pour le modèle gratuit n'était pas terminée, ${demo}. Renvoyez-le dans un instant.`,
        failed: `La vérification du navigateur de Cloudflare a échoué, ${demo}. Renvoyez-le dans un instant.`,
        hour: `Vous avez utilisé les ${p.count} tours du modèle gratuit pour cette heure, ${demo}. Réessayez plus tard, ou utilisez votre propre modèle.`,
        day: `Vous avez utilisé les ${p.count} tours du modèle gratuit pour aujourd'hui, ${demo}. Réessayez demain, ou utilisez votre propre modèle.`,
        network: `Des visiteurs de votre réseau ont utilisé les tours du modèle gratuit pour l'instant, ${demo}. Réessayez plus tard, ou utilisez votre propre modèle.`,
      }[p.why];
    },
  }),
} as const;

export type LineKey = keyof typeof LINES;
export type LineParams<K extends LineKey> = Parameters<
  (typeof LINES)[K]["en"]
>[0];

/** One of the agent's lines, in the language, with its facts filled in. */
export function say<K extends LineKey>(
  language: Language,
  key: K,
  ...params: LineParams<K> extends Record<string, never> ? [] : [LineParams<K>]
): string {
  const phrase = LINES[key][language] as (p: unknown) => string;
  return phrase(params[0] ?? {});
}
