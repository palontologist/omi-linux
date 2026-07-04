// src/main/integrations/signLanguage.ts
import axios from 'axios'
import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

export type SignGloss = {
  gloss: string; // The sign language representation (e.g., "HELLO", "STORE", "GO")
  duration: number; // How long the sign should be held (in seconds)
  timestamp: number; // When the sign starts relative to the audio
  swr?: string; // SignWriting representation (e.g., "SWR:...")
};

export type TranslationResult = {
  originalText: string;
  poseUrl: string;
  glosses: SignGloss[];
  swrFull?: string; // Full SignWriting sequence for the sentence
};

/**
 * Translates spoken text into Sign Language Poses and Glosses.
 * Uses the sign.mt API for high-quality skeletal animations.
 */
export async function translateToGlosses(text: string, spokenLanguage: string = 'en', signedLanguage: string = 'ase'): Promise<TranslationResult> {
  const trimmedText = text.trim();
  
  if (!trimmedText) {
    return {
      originalText: text,
      poseUrl: '',
      glosses: []
    };
  }

  const apiPose = 'https://us-central1-sign-mt.cloudfunctions.net/spoken_text_to_signed_pose';
  const apiVideo = 'https://us-central1-sign-mt.cloudfunctions.net/spoken_text_to_signed_video';
  
  const poseUrl = `${apiPose}?text=${encodeURIComponent(trimmedText)}&spoken=${spokenLanguage}&signed=${signedLanguage}`;
  const videoUrl = `${apiVideo}?text=${encodeURIComponent(trimmedText)}&spoken=${spokenLanguage}&signed=${signedLanguage}`;

  const cacheKey = crypto
    .createHash('sha1')
    .update(`${spokenLanguage}|${signedLanguage}|${trimmedText}`)
    .digest('hex')

  const poseDir = path.join(app.getPath('temp'), 'omi-sign-poses')
  const posePath = path.join(poseDir, `${cacheKey}.pose`)

    try {
      await fs.mkdir(poseDir, { recursive: true })

      // Try to get video first as it's more reliable for rendering
      try {
        const videoResponse = await axios.get(videoUrl, { 
          responseType: 'arraybuffer',
          timeout: 5000 
        });
        const videoData = Buffer.from(videoResponse.data);
        
        // If it's a small response and looks like a URL, use it directly
        const dataString = videoData.toString('utf8');
        if (dataString.startsWith('http')) {
          return {
            originalText: text,
            poseUrl: dataString,
            glosses: []
          };
        }

        // Otherwise, it's likely the video binary itself. Save it to a file.
        const videoCacheKey = crypto.createHash('sha1').update(`video|${spokenLanguage}|${signedLanguage}|${trimmedText}`).digest('hex');
        const videoPath = path.join(poseDir, `${videoCacheKey}.mp4`);
        await fs.writeFile(videoPath, videoData);
        
        return {
          originalText: text,
          poseUrl: `omi-asset://${videoCacheKey}.mp4`,
          glosses: []
        };
      } catch (e) {
        console.log('[sign-language] Video API failed, falling back to pose:', e);
      }

      let poseBytes: Buffer;
      try {
        poseBytes = await fs.readFile(posePath)
      } catch {
        const response = await axios.get<ArrayBuffer>(poseUrl, {
          responseType: 'arraybuffer',
          timeout: 5000
        })
        poseBytes = Buffer.from(response.data)
        await fs.writeFile(posePath, poseBytes)
      }
    
      return {
        originalText: text,
        poseUrl: `omi-asset://${cacheKey}.pose`,
        glosses: []
      }
    } catch (error) {
      console.error('[sign-language] pose download failed, falling back to remote URL:', error)
      return {
        originalText: text,
        poseUrl: poseUrl,
        glosses: []
      }
    }
}
