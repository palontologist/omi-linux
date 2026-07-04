import { useEffect, useRef, useState } from 'react'
import { SignAvatar } from '../components/signLanguage/SignAvatar'
import { SignVideo } from '../components/signLanguage/SignVideo'
import { SignWritingView } from '../components/signLanguage/SignWritingView'
import { TranslationResult } from '../../../shared/types'
import { useAppState } from '../state/AppStateProvider'


const FALLBACK_POSE_HOLD_MS = 6000

const SPOKEN_LANGUAGES = [
  'en', 'de', 'fr', 'af', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'ca', 'ceb', 'ny', 'zh', 'co', 'hr', 'cs', 'da', 'nl', 'eo', 'et', 'tl', 'fi', 'fy', 'gl', 'ka', 'es', 'el', 'gu', 'ht', 'ha', 'haw', 'he', 'hi', 'hmn', 'hu', 'is', 'ig', 'id', 'ga', 'it', 'ja', 'jv', 'kn', 'kk', 'km', 'rw', 'ko', 'ku', 'ky', 'lo', 'la', 'lv', 'lt', 'lb', 'mk', 'mg', 'ms', 'ml', 'mt', 'mi', 'mr', 'mn', 'my', 'ne', 'no', 'or', 'ps', 'fa', 'pl', 'pt', 'pa', 'ro', 'ru', 'sm', 'gd', 'sr', 'st', 'sn', 'sd', 'si', 'sk', 'sl', 'so', 'su', 'sw', 'sv', 'tg', 'ta', 'tt', 'te', 'th', 'tr', 'tk', 'uk', 'ur', 'ug', 'uz', 'vi', 'cy', 'xh', 'yi', 'yo', 'zu'
];

const SIGNED_LANGUAGES = [
  'ase', 'gsg', 'fsl', 'bfi', 'ils', 'sgg', 'ssr', 'slf', 'isr', 'ssp', 'jos', 'rsl-by', 'bqn', 'csl', 'csq', 'cse', 'dsl', 'ins', 'nzs', 'eso', 'fse', 'asq', 'gss-cy', 'gss', 'icl', 'ise', 'jsl', 'lsl', 'lls', 'psc', 'pso', 'bzs', 'psr', 'rms', 'rsl', 'svk', 'aed', 'csg', 'csf', 'mfs', 'swl', 'tsm', 'ukl', 'pks'
];

export function SignLanguagePage() {
  const { recorder, startRecording } = useAppState()
  const [currentGloss, setCurrentGloss] = useState<string>('IDLE')
  const [currentSWR, setCurrentSWR] = useState<string>('')
  const [fullSWR, setFullSWR] = useState<string>('')
  const [poseUrl, setPoseUrl] = useState<string | null>(null)
  const [textInput, setTextInput] = useState('')
  const [spokenLang, setSpokenLang] = useState('en')
  const [signedLang, setSignedLang] = useState('ase')
  const [loading, setLoading] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    console.log('[SignLanguagePage] Setting up translation listener. Recording state:', recorder.recording);
    const unsubscribe = window.omi.onDeepgramSignUpdate((result: TranslationResult) => {
      console.log('[SignLanguagePage] EVENT RECEIVED:', result);
      
      // We only update the avatar if we are currently recording or if the 
      // update is a "final" result. For now, we remove the strict guard 
      // to ensure the avatar triggers, but we'll add a debouncer/filter.
      
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []

      setFullSWR(result.swrFull || '');
      setPoseUrl(result.poseUrl || null);
      console.log('[SignLanguagePage] setPoseUrl called with:', result.poseUrl);
      
      if (result.poseUrl) {
        setCurrentGloss('SIGNING');
      }


      result.glosses.forEach((g: any) => {
        timersRef.current.push(setTimeout(() => {
          setCurrentGloss(g.gloss);
          setCurrentSWR(g.swr || '');
        }, g.timestamp * 1000))
      });

      const totalDuration = result.glosses.length > 0 
        ? result.glosses[result.glosses.length - 1].timestamp + result.glosses[result.glosses.length - 1].duration 
        : 0;
      const resetDelay = Math.max(totalDuration * 1000, result.poseUrl ? FALLBACK_POSE_HOLD_MS : 0)
      
      timersRef.current.push(setTimeout(() => {
        setCurrentGloss('IDLE');
        setCurrentSWR('');
        setPoseUrl(null);
      }, resetDelay))
    });

    return () => {
      console.log('[SignLanguagePage] Cleaning up translation listener');
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      unsubscribe()
    };
  }, [recorder.recording])

  const handleTranslate = async () => {
    const textToTranslate = textInput.trim() || [...recorder.micLines.map(l => l.text), recorder.micInterim].join(' ').trim();
    if (!textToTranslate) return;

    setLoading(true);
    setCurrentGloss('TRANSLATING...');
    try {
      const result = await window.omi.signLanguageTranslate({
        text: textToTranslate,
        spokenLanguage: spokenLang,
        signedLanguage: signedLang
      });
      
      setFullSWR(result.swrFull || '');
      setPoseUrl(result.poseUrl || null);
      
      if (result.poseUrl) {
        setCurrentGloss('SIGNING');
      } else {
        setCurrentGloss('IDLE');
      }
    } catch (e) {
      console.error('[SignLanguagePage] Translation error:', e);
      setCurrentGloss('ERROR');
    } finally {
      setLoading(false);
    }
  };

  const handleTestAvatar = async () => {
    setLoading(true);
    setCurrentGloss('TESTING...');
    try {
      // Use a simple known-good text for testing
      const result = await window.omi.signLanguageTranslate({
        text: 'Hello',
        spokenLanguage: 'en',
        signedLanguage: 'ase'
      });
      setPoseUrl(result.poseUrl);
      setCurrentGloss('SIGNING');
    } catch (e) {
      console.error('[SignLanguagePage] Test failed:', e);
      setCurrentGloss('ERROR');
    } finally {
      setLoading(false);
    }
  };



  const handleRecordToggle = () => {
    startRecording();
  };

  const fullTranscript = [...recorder.micLines.map(l => l.text), recorder.micInterim].join(' ').trim();

  return (
    <div className="flex h-full flex-col items-center justify-center bg-neutral-900 p-8 text-white">
    <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold">Sign Language Translator</h1>
        <p className="mt-2 text-neutral-400">Real-time speech and text to skeletal animation</p>
      </div>

      <div className="mb-8 flex flex-col items-center gap-6 w-full max-w-2xl">
        {/* Manual Text Input Section */}
        <div className="flex w-full gap-2">
          <input 
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type something to translate..."
            className="flex-1 px-4 py-3 rounded-xl bg-black/40 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <button
            onClick={handleTranslate}
            disabled={(!textInput && !fullTranscript) || loading}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-700 text-white font-bold rounded-xl transition-all shadow-lg"
          >
            {loading ? '...' : 'Translate'}
          </button>
        </div>

        <div className="flex items-center gap-4 w-full justify-center">
          <div className="h-px flex-1 bg-white/10"></div>
          <span className="text-xs text-neutral-500 uppercase font-bold tracking-widest">Or use voice</span>
          <div className="h-px flex-1 bg-white/10"></div>
        </div>

        <div className="flex gap-2 w-full justify-center">
          <button
            onClick={handleTestAvatar}
            className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white text-xs font-bold rounded-lg transition-all uppercase tracking-wider border border-white/10"
          >
            Test Avatar (Hello)
          </button>
        </div>

        {/* Voice Input Section */}
        <div className="flex flex-col items-center gap-4 w-full">
          <button
            onClick={handleRecordToggle}
            className={`flex items-center gap-2 px-8 py-4 rounded-full font-bold text-lg transition-all shadow-lg ${
              recorder.recording 
                ? 'bg-red-500 hover:bg-red-600 animate-pulse text-white' 
                : 'bg-neutral-800 hover:bg-neutral-700 text-white border border-white/10'
            }`}
          >
            <div className={`w-3 h-3 rounded-full ${recorder.recording ? 'bg-white' : 'bg-red-400'}`} />
            {recorder.recording ? 'Stop Recording' : 'Start Recording'}
          </button>
          
          <div className={`mt-2 p-4 rounded-xl bg-black/40 border border-white/10 text-center min-h-[60px] flex flex-col items-center justify-center transition-opacity ${recorder.recording ? 'opacity-100' : 'opacity-50'}`}>
            <div className="flex items-center justify-center mb-2">
              <span className="text-neutral-400 mr-2 text-sm uppercase tracking-widest">Hearing:</span>
              <span className="text-xl font-medium text-blue-300">
                {fullTranscript || (recorder.recording ? 'Listening...' : 'Press start to speak')}
              </span>
            </div>
          </div>
        </div>

        {/* Language Selection */}
        <div className="flex gap-4 w-full justify-center">
          <div className="flex flex-col gap-2">
            <label className="text-xs text-neutral-500 uppercase font-bold tracking-widest text-center">Spoken Language</label>
            <select 
              value={spokenLang}
              onChange={(e) => setSpokenLang(e.target.value)}
              className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SPOKEN_LANGUAGES.map(lang => (
                <option key={lang} value={lang}>{lang.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-neutral-500 uppercase font-bold tracking-widest text-center">Signed Language</label>
            <select 
              value={signedLang}
              onChange={(e) => setSignedLang(e.target.value)}
              className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {SIGNED_LANGUAGES.map(lang => (
                <option key={lang} value={lang}>{lang.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex w-full max-w-6xl flex-col gap-8 lg:flex-row">
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl bg-black/50 p-6 shadow-2xl border border-white/10">
          <div className="mb-4 text-sm font-medium text-neutral-500 uppercase tracking-widest">
            Skeletal Avatar
          </div>
           <div className="relative h-[500px] w-full max-w-md overflow-hidden rounded-2xl bg-neutral-800">
             {console.log('[SignLanguagePage] Render - poseUrl:', poseUrl)}
              {poseUrl && (poseUrl.endsWith('.mp4') || poseUrl.includes('.mp4') || poseUrl.includes('video')) ? (
                <SignVideo videoUrl={poseUrl} />
              ) : (
                <SignAvatar poseUrl={poseUrl} />
              )}

           </div>
            <div className="mt-4 text-xl font-semibold text-blue-400">
            Status: {currentGloss}
          </div>
        </div>

        <div className="flex w-full max-w-md flex-col gap-6 rounded-3xl bg-neutral-800/50 p-6 border border-white/10">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-neutral-400">SignWriting (SWR)</span>
            <div className="min-h-[150px] rounded-xl bg-black/40 p-4">
              <SignWritingView swr={currentSWR || fullSWR} />
            </div>
          </div>
          
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-neutral-400">Current Gloss</span>
            <div className="rounded-xl bg-black/40 p-4 text-center text-2xl font-bold text-white">
              {currentGloss}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
