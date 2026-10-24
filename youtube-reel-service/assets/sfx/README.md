# Ending sound effect

`end.wav` is played in a short tail after the last word of every reel (setting `REEL_END_SFX`, volume `REEL_END_SFX_VOLUME`).

- Sound: "Distant car tire screetch" by **Sadiquecat**, https://freesound.org/people/Sadiquecat/sounds/737192/
- License: **CC0 1.0** (public domain, commercial use, no credit needed; checked on the sound's page on 2026-10-24).
- Prepared: gain +5.6 dB so the loudest point is about -4 dB, stereo, 48 kHz (no other change).

## Change the sound

1. Put the new file (wav or mp3, ideally 0.5 to 2 seconds, from a source that allows commercial use) in this folder.
2. Set `REEL_END_SFX_FILE=<file name>` in `youtube-reel-service/.env.prod` and run `docker compose -f docker-compose.reels.yml up -d`.
3. Check its level: it is mixed at `REEL_END_SFX_VOLUME` (0.7) after the voice is level-matched; aim for a file whose loudest point is about -4 dB.
Reels already rendered keep their old sound until they are re-rendered.
