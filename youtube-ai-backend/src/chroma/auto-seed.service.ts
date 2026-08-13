import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaService } from './chroma.service';

const BOOK_PASSAGES = [
  // === SYNOPSIS / THEMES ===
  {
    id: 'book-synopsis-001',
    text: `SYNOPSIS: Mike McCormick, a young boy from Kingston, Jamaica, was lost from his first steps into the United States. Separated from his mother Trina, left to survive with a judgmental father, grandmother, and older brother Ron. The absence of love leaves Mike with an always suspecting and non-trusting nature — everyone he meets is on a timetable as to when they will cross him. When love is shown, it is greeted by a shielded heart. Yet within his mind there is an awareness he can't identify, until one comes along who cannot be denied. The walls of fear melt away, and he becomes more than a feared street hustler — he becomes a human being.`,
    metadata: { chapter: 'synopsis', theme: 'trust,love,transformation', type: 'summary' },
  },

  // === TRUST AND PARANOIA ===
  {
    id: 'book-trust-001',
    text: `TRUST PSYCHOLOGY: This absence of love leaves Mike with an always suspecting and non-trusting nature, to the degree that everyone he meets, is on a timetable as to when they will cross him. When some love is shown or given, it is greeted by a shielded heart, convinced that it must be on guard at all times.`,
    metadata: { chapter: 'synopsis', theme: 'trust,paranoia,psychology', type: 'analysis' },
  },
  {
    id: 'book-trust-002',
    text: `UNIQUE ON TRUST: "Bitch, are you crazy? Get the fuck off me!" He shoves Stacey back when she tries to hug him. Then later: "I didn't mean none of that. I'm just going through some shit right now. I didn't mean to take it out on you." — This is the pattern. Love offered gets rejected with violence, then regret. The prison of not trusting anyone, even people who saved your life.`,
    metadata: { chapter: 'early-life', theme: 'trust,rejection,vulnerability', type: 'scene' },
  },
  {
    id: 'book-trust-003',
    text: `STACY'S WISDOM: "One of these days you're going to have to trust somebody. So your best bet is to make sure you're trusting the right kind of people, and turning your back on the wrong ones. Don't turn your back on something you know in your heart is good for you." — Stacy, the nurse who saved his life, telling Unique what he needed to hear.`,
    metadata: { chapter: 'club-millennium', theme: 'trust,wisdom,love', type: 'dialogue' },
  },

  // === FIRST NIGHT INSIDE / PRISON ===
  {
    id: 'book-prison-001',
    text: `FIRST NIGHT — YARDVILLE: Mike is 12 years old in Yardville penitentiary. A giant kid asks about his shoes. Later, three goons come to his cell. Mike grabs a mop wringer and beats the giant unconscious. Then beats the next one savagely. Three guards rush in. The leading guard cracks Mike across the back of his head with a flashlight. His unconscious body slumps to the floor. They drag him out by his shoulders.`,
    metadata: { chapter: 'yardville', theme: 'first-night,violence,survival', type: 'scene' },
  },
  {
    id: 'book-prison-002',
    text: `SOLITARY CONFINEMENT: It is pitch black in his cell. Mike cannot even be seen on his bunk. A sliver of light enters the room after the guard opens the slot in the center of the door. The slot is used to slide the prisoner his food tray. "McCormick! Get up and get dressed! You got a visitor." — Omar, the Muslim prisoner, gives him the Holy Qu'ran through the bars.`,
    metadata: { chapter: 'yardville', theme: 'solitary,transformation,faith', type: 'scene' },
  },
  {
    id: 'book-prison-003',
    text: `OMAR'S LESSON: "I don't write the law. What's right is right, and what's wrong is the fact that they got you sitting up here in Yardsville penitentiary, instead of a juvenile camp. They know what they're doing. They figured you're a kid, so you won't double check their bullshit." — Omar, the jailhouse lawyer who got his own sentence reduced from three life sentences plus 40 years down to 18 years.`,
    metadata: { chapter: 'yardville', theme: 'legal-rights,justice,youth', type: 'dialogue' },
  },

  // === MOTHER IMPACT ===
  {
    id: 'book-mother-001',
    text: `TRINA'S VISIT: Mike's mother visits him in juvenile detention. She sees him in chains. "Oh, my baby, my baby! I'm so sorry baby. Look what time has done to you." She hugs him and they cry together. "I never should have let him have you. I never should have let him have you baby. I love you so much." — The mother's guilt, the child's pain, the system that separated them.`,
    metadata: { chapter: 'yardville', theme: 'mother,family,pain,love', type: 'scene' },
  },
  {
    id: 'book-mother-002',
    text: `UNIQUE BUYS HIS MOTHER A HOUSE: Trina gets on her knees crying, covering her face with her hands. "Baby I am just so happy. All I ever wanted was my babies back, and look, what you my youngest child has done for me. Baby I love you so much, and it has nothing to do with this house. But I do love this house, baby." — The moment a kingpin's money becomes a mother's blessing.`,
    metadata: { chapter: 'miami', theme: 'mother,love,success,gratitude', type: 'scene' },
  },

  // === STREET CODE ===
  {
    id: 'book-street-001',
    text: `RON'S BETRAYAL: Unique comes home from prison and finds his brother Ron stole everything — the money, the drugs, the furniture. Ron emptied the apartment and ran. Unique finds him years later and puts a gun to his head. But Ron's kids are there. "You owe your life to your kids, nigga. You got a pass on your life." — The street code says kill him. The human code says his children saved him.`,
    metadata: { chapter: 'return', theme: 'betrayal,family,street-code,forgiveness', type: 'scene' },
  },
  {
    id: 'book-street-002',
    text: `BOB'S DEATH: Mike and Bob rob a Spanish drug spot. On the rooftop, Mike's prisoner catches a bullet. Mike catches a slug beneath the heart. He looks at Bob — a small stream of blood coming from the hole in the center of his forehead. The eyes he is staring into are lifeless. Bob is dead. Mike tumbles over the railing. — The cost of the game. Your partner's life, and nearly your own.`,
    metadata: { chapter: 'early-life', theme: 'death,violence,cost,loyalty', type: 'scene' },
  },

  // === DESIRE VS SURVIVAL ===
  {
    id: 'book-desire-001',
    text: `JADE'S QUESTION: "You hustle to survive, right?" Jade asks. "Mmhmm." "Well, does your desire to stay in the game really outweigh your desire to leave the game alone?" — This question haunts Unique. It's the question that changes everything. The question that makes a kingpin think about becoming a human being.`,
    metadata: { chapter: 'miami', theme: 'desire,survival,transformation,love', type: 'dialogue' },
  },

  // === LOVE AND VULNERABILITY ===
  {
    id: 'book-love-001',
    text: `UNIQUE LEAVES JADE: "I'm sorry, I had to leave, but there is something I'm going through in my mind that I can't explain because I don't know what it is. But, I do know that it's you who brought it all about. Don't be upset by my leaving so abruptly, with the life I lead you should thank me for leaving instead of being mad at me for being gone." — A man who has never been loved runs from love because he doesn't recognize it.`,
    metadata: { chapter: 'miami', theme: 'love,fear,vulnerability,running', type: 'letter' },
  },
  {
    id: 'book-love-002',
    text: `JADE RETURNS: Standing beside Stone holding a suitcase is Jade. A single tear escapes her eye. She refused to spend a dime of the hundred thousand until she found him. "I came up here for you, so I guess how long I'll be here is something you'll be deciding." — The woman who wouldn't give up on the man who gave up on himself.`,
    metadata: { chapter: 'club-millennium', theme: 'love,persistence,transformation', type: 'scene' },
  },

  // === THE LION PRAYER ===
  {
    id: 'book-lion-001',
    text: `THE LION PRAYER: Mike kneels before the lion's cage at the Bronx Zoo. "Oh, mighty King of the jungle. Please forgive me for my sins. I know man is not supposed to kill as you do, oh mighty one. But, getting by in my own jungle is a bitch and survival is only gained by the strong. I am alone, oh mighty one. I ask of you to continue to give me strength." — A boy praying to an animal because no human taught him how to pray to God.`,
    metadata: { chapter: 'early-life', theme: 'prayer,loneliness,survival,spirituality', type: 'scene' },
  },

  // === JADE'S BACKGROUND ===
  {
    id: 'book-jade-001',
    text: `JADE'S STORY: She was from a wealthy family in Baltimore. Both parents lawyers. They wanted her to be a lawyer too. She wanted to be an actress. When she enrolled in Baltimore School of Performing Arts, her parents cut her off financially. She struggled, then China convinced her to try stripping in Miami. "I hate stripping. I feel violated every time I take the stage. I wasn't into drugs but weed helps me to deal with my job." — Two people broken by different systems finding each other.`,
    metadata: { chapter: 'miami', theme: 'dreams,survival,dignity,family', type: 'dialogue' },
  },

  // === FATHER WOUND ===
  {
    id: 'book-father-001',
    text: `MIKE CONFRONTS CHAUNCEY: "Where the hell is my mother? Why won't you give me the information I need to find her?" Chauncey: "Your fucking mother don't want you! Her hoe ass is down in Miami living good!" Mike pulls his gun and aims it between his father's eyes. "Nigga, I will kill your muthafucking ass right here! I didn't ask to be bought into this fucked up world. Your black ass brought me here." — The father wound that drives everything.`,
    metadata: { chapter: 'early-life', theme: 'father,anger,rejection,abandonment', type: 'scene' },
  },
  {
    id: 'book-father-002',
    text: `KENNY SAVES THEIR FATHER: Kenny stands beside Mike. "Remember our promise that we would always be there for each other? Well, you're about to do something stupid and I'm here for you now. No matter what you think of pops, I love you and he's still our father." Mike lowers the gun. "This one here is for you Kenny. Because of our promise, I won't kill him." — The brother's bond stopping a murder. The promise that saved a life.`,
    metadata: { chapter: 'early-life', theme: 'brother,promise,forgiveness,restraint', type: 'scene' },
  },

  // === CLUB MILLENNIUM / SUCCESS ===
  {
    id: 'book-club-001',
    text: `CLUB MILLENNIUM SPEECH: "What's up everybody? How y'all feeling tonight? As long as y'all enjoy yourselves in my club, I'll enjoy myself. This is a respectable club and it's gonna be run like one. That means no guns and no knives. And ladies, if you want to bring your pretty little asses out at night and act stuck up, I suggest you keep your pretty little asses away from Club Millennium because we don't sweat hoes here." — The voice. The confidence. The humor. The rules.`,
    metadata: { chapter: 'club-millennium', theme: 'success,voice,leadership,humor', type: 'speech' },
  },

  // === VOICE PATTERNS ===
  {
    id: 'book-voice-001',
    text: `VOICE PATTERN — UNIQUE'S SPEECH STYLE: Short, direct, commanding. "Get your ass in, bitch." (playfully). "Nigga, I will kill your muthafucking ass right here!" (when threatened). "Damn, I'm on some shit, right now!" (self-aware humor). "This one here is for you Kenny." (tender with family). The voice shifts between street soldier, comedian, philosopher, and vulnerable child — sometimes in the same sentence.`,
    metadata: { chapter: 'voice', theme: 'voice,pattern,personality', type: 'analysis' },
  },

  // === ANITA BAKER / RITUALS ===
  {
    id: 'book-ritual-001',
    text: `JADE'S RITUAL: "I wake up every morning, smoke a spliff, drink some herbal tea, and let Anita Baker get my day started." Unique didn't tell her that he also engaged in this very same ritual every morning. — Two strangers sharing the same healing routine without knowing it. The universe connecting broken people through music and silence.`,
    metadata: { chapter: 'miami', theme: 'ritual,music,connection,healing', type: 'scene' },
  },

  // === STACEY AND DAVID ===
  {
    id: 'book-healers-001',
    text: `THE HEALERS: Stacey the nurse and David the cab driver — two strangers who saved Mike's life after he was shot. They didn't know him. They had no reason to help. But they stayed for days, redressing his wounds, cooking for him, helping him walk again. David: "I already lost my job two days ago anyway. I could use the money." Stacey: "I'll stay as long as you need me." — The people who show up when nobody else will.`,
    metadata: { chapter: 'early-life', theme: 'kindness,strangers,healing,loyalty', type: 'scene' },
  },

  // === THE COST ===
  {
    id: 'book-cost-001',
    text: `THE COST: Mike is 13 years old, shot twice, lying on a couch rubbing cocaine into his wounds because he can't go to a hospital. His partner is dead. His mother is gone. His father threw him out. His grandmother calls him evil. He sells weed through a cylinder in a metal door. He freebases cocaine. He kills people. He is 13 years old. — This is what "the streets" actually look like. Not the Instagram version.`,
    metadata: { chapter: 'early-life', theme: 'cost,youth,pain,reality', type: 'analysis' },
  },
];

@Injectable()
export class AutoSeedService implements OnModuleInit {
  private readonly logger = new Logger(AutoSeedService.name);

  constructor(
    private readonly chromaService: ChromaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    // Run async seed worker after module initialization to avoid blocking NestJS startup
    setImmediate(() => this.runAutoSeed());
  }

  private async ensureOllamaModel(ollamaUrl: string): Promise<boolean> {
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const hasModel = data.models?.some((m: any) => m.name?.startsWith('nomic-embed-text'));
        if (hasModel) {
          this.logger.log('✅ Ollama embedding model "nomic-embed-text" is ready.');
          return true;
        }
      }

      this.logger.log('📥 "nomic-embed-text" not found in Ollama. Auto-downloading embedding model on 1st run...');
      const pullRes = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'nomic-embed-text', stream: false }),
      });

      if (pullRes.ok) {
        this.logger.log('✅ Successfully auto-downloaded "nomic-embed-text" model into Ollama!');
        return true;
      }
    } catch (error) {
      this.logger.warn(`⚠️ Ollama model check failed at ${ollamaUrl}: ${error.message}`);
    }
    return false;
  }

  private async runAutoSeed() {
    const ollamaUrl = this.configService.get<string>('OLLAMA_URL', 'http://localhost:11434');

    // Step 1: Ensure Ollama embedding model is installed
    let modelReady = false;
    for (let i = 1; i <= 5; i++) {
      modelReady = await this.ensureOllamaModel(ollamaUrl);
      if (modelReady) break;
      this.logger.log(`⏳ Waiting for Ollama container to respond (attempt ${i}/5)...`);
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (!modelReady) {
      this.logger.warn('⚠️ Ollama container not available yet. Auto-seeding skipped for now.');
      return;
    }

    // Step 2: Check if ChromaDB collection is already seeded
    try {
      const existing = await this.chromaService.query('client_book', 'trust', 1);
      if (existing && existing.length > 0) {
        this.logger.log('🌱 ChromaDB "client_book" collection is already seeded.');
        return;
      }
    } catch (error) {
      this.logger.log('🌱 "client_book" empty or unseeded. Initiating auto-seed on 1st run...');
    }

    // Step 3: Ingest passages into ChromaDB
    try {
      this.logger.log(`🌱 Auto-seeding ${BOOK_PASSAGES.length} passages into ChromaDB "client_book"...`);
      for (const passage of BOOK_PASSAGES) {
        await this.chromaService.upsert(
          'client_book',
          passage.id,
          passage.text,
          passage.metadata,
        );
      }
      this.logger.log('✅ Auto-seeding completed successfully on 1st run!');
    } catch (err) {
      this.logger.warn(`⚠️ Auto-seeding encountered an issue: ${err.message}`);
    }
  }
}

