// HJEN Studio learn content — the Learn hub docs.
// Videos are placeholders served from LEARN_MEDIA_DIR via hjen-file://
// — swap them for HJEN-shot clips later (same filenames = zero code change).
// Regenerate with scratchpad/port_learn.js.

export interface LearnPageContent {
  key: string;
  title: string;
  subtitle: string;
  paragraphs: string[];
  videos: string[];
}
export interface LearnGroupContent {
  key: string;
  title: string;
  pages: LearnPageContent[];
}

// Where the lesson clips would live. This was an absolute path on the author's
// own disk — a directory that does not exist even there any more, and cannot
// exist on anyone else's Mac, so every <video> in Learn resolved to a broken
// hjen-file:// URL. Empty means "no clips in this build": mediaUrl() returns ''
// and LearnPage renders the written lesson without a dead player.
export const LEARN_MEDIA_DIR = '';

export const LEARN_CONTENT: LearnGroupContent[] = [
  {
    "key": "getting-started",
    "title": "Getting started",
    "pages": [
      {
        "key": "welcome",
        "title": "Welcome",
        "subtitle": "An introduction to HJEN Studio and the way directors work inside it.",
        "paragraphs": [
          "HJEN Studio is a soundstage for AI filmmaking. You build on an endless canvas — set down shots, make takes with a range of AI models, keep working a frame until it holds, then assemble the results on a timeline. Everything is tuned for fast loops, laying work out in space, and building alongside your team in real time.",
          "Press V to drop a shot. Write your direction, choose a model, and make a take. When a take misses, rework the prompt, swap the reference image, or reach for a different model. Each new take sits next to the one before it, so comparison is immediate.",
          "Once the frames are the ones you want, pull them down to the timeline and export. HJEN Studio reaches Veo, Kling, Sora and more from a single interface, so you match the model to the shot rather than the shot to the model."
        ],
        "videos": [
          "welcome1.mp4",
          "welcome2.mp4"
        ]
      },
      {
        "key": "first-shot",
        "title": "Your first shot",
        "subtitle": "Make a still, then set it in motion.",
        "paragraphs": [
          "Every project opens on an empty canvas. Press V to set down a shot, write your direction, choose a model, and make the take. That single move is the heart of the tool; everything after it is refinement.",
          "You can work image-to-video, video-to-video, or straight from text — pick whichever route suits the shot. A common path is to lock a still first, whether made in-app or brought in, then feed it as the opening frame of a clip. The still fixes the composition while the model supplies the movement.",
          "Shortcuts",
          "V",
          "Drop a fresh shot onto the canvas."
        ],
        "videos": []
      },
      {
        "key": "iterating",
        "title": "Iterating on shots",
        "subtitle": "Sharpen a shot by working it fast, take after take.",
        "paragraphs": [
          "The first take is almost never the keeper. Rephrase your direction, change the reference, switch models, or shift the length. Each attempt lands right next to the last, so you can weigh them against each other at a glance.",
          "The whole studio runs on one loop — make, look, adjust, remake. The canvas hands you all the room you need to fan out options, and stacks keep every version of a single shot bundled while you home in on it."
        ],
        "videos": [
          "iterate.mp4"
        ]
      }
    ]
  },
  {
    "key": "canvas",
    "title": "Canvas",
    "pages": [
      {
        "key": "overview",
        "title": "Overview",
        "subtitle": "The boundless space that holds the entire project.",
        "paragraphs": [
          "The canvas is a limitless flat workspace, and it holds all of it — shots, stills, audio, sets, subjects, and written notes. Nothing hides in pages or folders. You arrange by position, the same way you'd spread selects across a light table or pin references to a wall.",
          "Everything you place behaves the same way when you select it, move it, or sort it. Pull back to take in the whole project or push in to study one frame. Scroll to zoom, drag with two fingers to pan, and tap F to frame the entire board."
        ],
        "videos": []
      },
      {
        "key": "nodes",
        "title": "Canvas objects",
        "subtitle": "The full set of objects the canvas can hold.",
        "paragraphs": [
          "Hit a shortcut to arm placement, then click the canvas to drop the object. V sets a video shot, I an image, T a written note, B a bin, S a subject, Shift V a variable, Shift S a set, and A an audio clip.",
          "Each kind does its own job. Shots and images carry the picture. Subjects hold a character or prop steady from frame to frame. Variables save prompt fragments you reuse. Bins gather related work. Notes are reminders for you or your team. Sets are 3D locations you can shoot into.",
          "Shortcuts",
          "V",
          "Drop a fresh shot onto the canvas.",
          "I",
          "Set an image down on the canvas.",
          "T",
          "Leave a written note on the canvas.",
          "B",
          "Open a bin to gather related work.",
          "S",
          "Add a subject to lock a character or prop.",
          "Shift+V",
          "Save a reusable prompt variable.",
          "Shift+S",
          "Set a location down on the canvas.",
          "A",
          "Drop an audio clip onto the canvas."
        ],
        "videos": [
          "canvas-objects.mp4"
        ]
      },
      {
        "key": "selection",
        "title": "Selection",
        "subtitle": "Pick work with a click, a shift-click, or a marquee drag.",
        "paragraphs": [
          "A click selects. Shift-click adds to what's already chosen. Drag across empty space to sweep a marquee around several objects. ⌘A grabs everything; Escape lets it all go.",
          "Whatever is selected wears a border. With more than one chosen, you can move, remove, or label the group in a single action. The inspector reports on the object you picked last.",
          "Shortcuts",
          "Cmd+A",
          "Grab every object on the canvas.",
          "Escape",
          "Let the current selection go."
        ],
        "videos": [
          "selection.mp4"
        ]
      },
      {
        "key": "organizing",
        "title": "Organizing",
        "subtitle": "Color tags, ratings, bins, and filtered views.",
        "paragraphs": [
          "Keys 1 to 5 drop a color tag on a shot. F flags a favorite; R flags a reject. This is the same triage an editor runs over dailies — star the takes that land, throw out the ones that don't, and sift what's left.",
          "Press B to open a bin, then drag shots in to cluster them on the board. A bin holds without hiding — the work stays out in the open. Shift F brings up filters for favorites, rejects, or one color tag. A filter only touches what's on screen, never the work itself.",
          "Shortcuts",
          "F",
          "Flag the chosen shot as a favorite.",
          "R",
          "Flag the chosen shot as a reject.",
          "B",
          "Open a bin to gather related work."
        ],
        "videos": [
          "organizing.mp4"
        ]
      },
      {
        "key": "drag-and-drop",
        "title": "Drag and drop",
        "subtitle": "Reposition work and pull files in from Finder.",
        "paragraphs": [
          "Drag any object to move it around the board. Drag a file straight from Finder onto the canvas to bring it in — HJEN Studio reads its type and builds the matching object for you. A picture arrives as an image; a clip arrives as a shot.",
          "You can also drag a shot off the canvas and onto the timeline to fold it into the cut."
        ],
        "videos": [
          "drag-and-drop.mp4"
        ]
      },
      {
        "key": "clipboard",
        "title": "Copy, paste, duplicate",
        "subtitle": "Copy, paste, and fast duplication.",
        "paragraphs": [
          "⌘C copies, ⌘V pastes, ⌘D duplicates. A pasted object lands close to its source with every setting carried over. When you just want a quick copy and don't need the clipboard, ⌘D is the shorter path.",
          "All of it works on one object or a whole selection. Copy five shots, paste them somewhere else on the board, and they hold the spacing they had between them.",
          "Shortcuts",
          "Cmd+C",
          "Copy whatever is selected.",
          "Cmd+V",
          "Paste what you copied."
        ],
        "videos": [
          "copypaste-duplicate1.mp4",
          "copypaste-duplicate2.mp4"
        ]
      },
      {
        "key": "undo-redo",
        "title": "Undo and redo",
        "subtitle": "Take back a change, or put it back.",
        "paragraphs": [
          "⌘Z reverses your last move; ⌘ Shift Z restores it. Undo reaches the canvas actions you'd expect — moving, deleting, renaming, and placing objects.",
          "Undo knows who did what. It walks back your own actions and leaves everyone else's alone — if a teammate nudges an object while you work, your ⌘Z won't touch their move."
        ],
        "videos": [
          "undoredo.mp4"
        ]
      },
      {
        "key": "rename",
        "title": "Renaming",
        "subtitle": "Rename objects right on the board.",
        "paragraphs": [
          "Pick an object and press Enter to edit its name in place. Type the new one and press Enter to keep it, or Escape to back out. The label sits beneath each object and makes shots easy to tell apart once the takes pile up."
        ],
        "videos": [
          "renaming.mp4"
        ]
      },
      {
        "key": "delete",
        "title": "Deleting",
        "subtitle": "Clear objects off the board.",
        "paragraphs": [
          "Delete or Backspace clears whatever is selected, whether that's a single object or a group. Nothing is final — ⌘Z pulls the work straight back."
        ],
        "videos": [
          "deleting.mp4"
        ]
      },
      {
        "key": "playback",
        "title": "Playback",
        "subtitle": "Play back shots and scrub the footage.",
        "paragraphs": [
          "Space starts and stops playback. J, K, and L run the transport — J reverses, L rolls forward, K halts. Tap L a second time for double speed. It's the same shuttle you know from Premiere, Avid, and DaVinci.",
          "Choose a shot and hit Space to watch it right where it sits on the board. The program monitor above the timeline shows the same frame at a bigger size.",
          "Shortcuts",
          "Space",
          "Start or stop the chosen shot."
        ],
        "videos": []
      }
    ]
  },
  {
    "key": "generation",
    "title": "Generation",
    "pages": [
      {
        "key": "overview",
        "title": "Overview",
        "subtitle": "How making takes with AI works in HJEN Studio.",
        "paragraphs": [
          "HJEN Studio speaks to a spread of AI models — Veo, Kling, Sora, and more — with no extra logins or API keys to juggle. Choose a model, write your direction, set the parameters, and make the take. Whatever comes back drops onto the canvas, ready to be reworked, rated, or cut into the timeline.",
          "Making takes is the loop everything turns on. Drop a shot, describe the frame, pick a model, and run it. If it misses, adjust and go again. The canvas gives you the room to line takes up and judge them together."
        ],
        "videos": []
      },
      {
        "key": "images",
        "title": "Images",
        "subtitle": "Make stills and put references to work.",
        "paragraphs": [
          "Stills are often where a shot begins. Make a frame, then hand it to a clip as its reference. You can just as easily bring in photos, boards, or concept art and use them as opening frames or as a guide for the look.",
          "Subjects hold a character or prop steady from shot to shot by tying the model to one fixed identity. Drop a subject on the board, pin reference images to it, and every shot that calls on it keeps that same look."
        ],
        "videos": [
          "generationImages.mp4"
        ]
      },
      {
        "key": "video",
        "title": "Video",
        "subtitle": "Make moving shots from direction and references.",
        "paragraphs": [
          "A clip is a prompt set into motion. When you want a tighter hand on it, add an opening frame, a closing frame, or a reference. Models differ in what they accept — some take a start and end frame to steer the camera precisely, while others do their best work from words alone.",
          "Length, resolution, and aspect ratio all ride on the model you pick. HJEN Studio holds the interface steady across them, so you state the intent once and see plainly which controls each model will honor."
        ],
        "videos": [
          "generationVideo.mp4"
        ]
      },
      {
        "key": "models",
        "title": "Models",
        "subtitle": "Knowing when to reach for Veo, Kling, Sora, and the rest.",
        "paragraphs": [
          "Every model leans a different way. Veo is strong on camera control and start-to-end frame composition. Kling is quick and confident with motion. Sora carries a look all its own. Wan suits stylized work. Ray covers both stills and clips.",
          "The picker spells out what each one does — clips, stills, or both — and not every model honors every control. Reach for the one that suits the shot rather than the one with the longest feature list. Any model you never touch can be tucked away in preferences."
        ],
        "videos": []
      },
      {
        "key": "prompting",
        "title": "Prompting",
        "subtitle": "Write direction that lands a cinematic frame.",
        "paragraphs": [
          "A prompt is direction, not description. Say what you'd say to a DP or a VFX supervisor — the camera move, the light, the pace, the feeling you're after. Concrete, physical words carry further than abstractions.",
          "\"Handheld follow, daylight coming through a window, the subject turning slowly\" beats \"a beautiful cinematic shot of a person\" every time. Name the move, name the source of light, name the action. Leave out words like \"stunning\" or \"breathtaking\"; a model has nothing to do with them.",
          "When you go again, change a single real thing at a time. It's the only way to know which change actually helped the shot."
        ],
        "videos": [
          "generationPrompt.mp4"
        ]
      },
      {
        "key": "credits",
        "title": "Credits",
        "subtitle": "How your spend on takes works.",
        "paragraphs": [
          "HJEN Studio measures spend in credits, and every take draws some down. How many depends on the model, the resolution, and the length. Your running balance sits in the account menu.",
          "Run dry and you can top up or move to a larger plan. If a take fails, the credits come back to you on their own. The supported-models page lists the cost of each model, so you can budget a shot before you commit to it."
        ],
        "videos": [
          "generationOlives.mp4"
        ]
      },
      {
        "key": "upscaling",
        "title": "Upscaling",
        "subtitle": "Raise resolution, recover detail, or move to HDR.",
        "paragraphs": [
          "Upscaling lifts a finished shot to a higher resolution, and it can sharpen detail or push the frame to HDR along the way. It handles both clips and stills. Select the shot or image and choose Upscale & Enhance — from the right-click menu, from the inspector, or with the U key.",
          "Source sets which version you build from, usually the original. The info icon opens that version's particulars — its size, its file type, the day it was made, and its asset ID.",
          "A preset is every setting below — model, resolution, quality, encoder, all of it — saved together under one name. Custom means you're dialing each control yourself; once a combination clicks, the plus button stores it as a named preset for next time. Presets carry across your team, so an entire project can hold one look and one spec.",
          "Operation picks the job: Upscale grows resolution and detail, Enhance clears noise and blur to rebuild the image, and HDR writes out a 10-bit or 16-bit high-dynamic-range file.",
          "Model is the engine behind the pass. All-purpose engines like Proteus fit most shots, detail and correction engines go after sharpness or a particular flaw, and the Starlight line reaches the top of the quality range. Stills have their own quick and generative engines.",
          "Resolution is the size you're aiming for, anywhere from HD to 8K. HJEN Studio prints the scale factor — 4x, say — and the ceiling each codec will allow.",
          "Quality governs how far the model goes in cleaning and sharpening. It runs on automatic to start, with HJEN Studio choosing sound settings on your behalf, and the manual dials — detail, noise, blur, grain, compression — only come out when you want to shape the look yourself.",
          "Output is about the encoder — the container the result is written to, whether H.265, H.264, or AV1, along with HDR and ProRes delivery formats. Compression is the trade between size and fidelity: Low holds the most detail in a heavier file, High does the reverse.",
          "Frame rate is how many frames land each second — the higher it climbs, the smoother the motion reads. Auto holds the source clip's rate, or you can name your own, say 24, 30, or 60 fps.",
          "What comes out joins the same stack as a fresh version, so you can flip between the original and the upscaled one to judge the difference.",
          "The credit cost tracks the model and the output size — clips bill by the second, stills by the megapixel, and the higher-grade engines like Starlight ask for more."
        ],
        "videos": [
          "generationUpscale.mp4"
        ]
      }
    ]
  },
  {
    "key": "sets",
    "title": "Sets",
    "pages": [
      {
        "key": "overview",
        "title": "Overview",
        "subtitle": "3D locations grown from one photograph.",
        "paragraphs": [
          "A set is a 3D location built out of a single frame. Bring in or make a reference photo, and HJEN Studio raises a space you can move through. Treat it as a virtual location — walk a camera across it, stand characters in it, and shoot from the exact angles you choose.",
          "It's the nearest thing to scouting and dressing a real stage — one location, many camera positions, and the geography holding true across every shot."
        ],
        "videos": []
      },
      {
        "key": "creating",
        "title": "Creating a set",
        "subtitle": "Grow a walkable 3D space from a single frame.",
        "paragraphs": [
          "Begin with a frame you've made or brought in. HJEN Studio raises a 3D space you can move through from it, which takes a few minutes to build.",
          "When it's ready, the set shows up as an object on your canvas. Double-click to step into the set viewer and move around inside it."
        ],
        "videos": [
          "setsCreating.mp4"
        ]
      },
      {
        "key": "characters",
        "title": "Characters",
        "subtitle": "One cast, held steady across every set shot.",
        "paragraphs": [
          "A character is a lasting identity you stand inside a set. Bring in or make a character sheet, and HJEN Studio finds the figure, lifts the wardrobe, and turns it into a reference you can reuse.",
          "Shoot from the set and the character stands in the 3D space with you. Casting stays true from angle to angle — same face, same wardrobe, only the framing changes."
        ],
        "videos": []
      },
      {
        "key": "viewer",
        "title": "Set viewer",
        "subtitle": "Move through the location and set your camera.",
        "paragraphs": [
          "The set viewer is a 3D window living inside the canvas. Drag to orbit, scroll to zoom, right-drag to pan — you're flying a virtual camera through the location.",
          "From wherever you land, you can grab a still as a reference or shoot the frame from that precise angle. The camera's position, the characters, and the location all fold into the prompt on their own."
        ],
        "videos": [
          "setviewer.mp4"
        ]
      }
    ]
  },
  {
    "key": "timeline",
    "title": "Timeline",
    "pages": [
      {
        "key": "overview",
        "title": "Overview",
        "subtitle": "Cut your shots together into a sequence.",
        "paragraphs": [
          "The timeline is where loose shots turn into a sequence. Drag them from the canvas onto tracks, put them in order, trim the ends, and watch the cut back. It isn't here to replace Premiere or DaVinci — it's here to get you a rough cut, let you feel the timing, and hand off a package for finishing.",
          "The mode switch in the toolbar flips you between the two. The canvas is for making and sorting; the timeline is for cutting."
        ],
        "videos": []
      },
      {
        "key": "clips",
        "title": "Shots and tracks",
        "subtitle": "Lay shots on the timeline and order them across tracks.",
        "paragraphs": [
          "Drag a shot from the canvas down to the timeline to bring it into the cut. Shots snap to one another and to the playhead, and you trim by pulling an edge. Add as many tracks as the edit calls for.",
          "Stack shots on their own tracks when you want to layer them. Right-click any shot on the timeline for moves like delete, slip, and swap."
        ],
        "videos": [
          "timelineShotsandtracks.mp4"
        ]
      },
      {
        "key": "sequences",
        "title": "Sequences",
        "subtitle": "Split the edit into scenes.",
        "paragraphs": [
          "Sequences break the timeline into scenes. Each one is a cut that stands on its own, which helps when you'd rather build scenes one at a time before joining them into the whole.",
          "Jump between sequences to work one part of the project without losing your place in the rest. Think of them as the reels or acts of a traditional offline."
        ],
        "videos": [
          "timelineSequence.mp4"
        ]
      },
      {
        "key": "audio",
        "title": "Audio",
        "subtitle": "Waveforms, voiceover, and score.",
        "paragraphs": [
          "Audio rides on tracks of its own. Bring it in by dragging files onto the timeline, or pull it from the canvas. Waveforms draw right on the track, so you can lay a cut against a beat or a line of dialogue.",
          "Voiceover and score behave the same — drop them in and slide them into place. Models that make sound of their own, Veo 3 among them, hand back shots with audio already baked in, and it follows the shot onto the timeline."
        ],
        "videos": []
      },
      {
        "key": "playback",
        "title": "Playback",
        "subtitle": "Run the cut with the transport keys.",
        "paragraphs": [
          "Space plays and pauses. J, K, and L shuttle back, stop, and forward. The playhead reads out the current frame in the program monitor.",
          "The transport is the one you already know from Premiere, Avid, and DaVinci, so the muscle memory comes with you."
        ],
        "videos": [
          "playback.mp4"
        ]
      }
    ]
  },
  {
    "key": "export",
    "title": "Export",
    "pages": [
      {
        "key": "overview",
        "title": "Overview",
        "subtitle": "Move your work out of HJEN Studio.",
        "paragraphs": [
          "Export carries your work out of HJEN Studio. Render an MP4 when you need a finished video on its own, or send an XML package to finish in Premiere, DaVinci Resolve, or CapCut. That package brings along your media and the shape of your timeline, so the edit opens ready to keep going in another tool.",
          "The right format follows wherever the project heads next — MP4 for reviews and hand-offs, XML for the road into post."
        ],
        "videos": []
      },
      {
        "key": "mp4",
        "title": "MP4",
        "subtitle": "Render straight to video.",
        "paragraphs": [
          "Reach for MP4 when you want a single video file to walk away with. Set the resolution and quality, then render. The file holds every timeline shot in order, trimmed exactly as you left them.",
          "It suits rough cuts, client reviews, and social — anywhere the video itself is the thing you're delivering."
        ],
        "videos": [
          "exportMp4.mp4"
        ]
      },
      {
        "key": "nle",
        "title": "XML export",
        "subtitle": "Hand off to Premiere, DaVinci, and CapCut.",
        "paragraphs": [
          "Send an XML package when the finish belongs in Premiere Pro, DaVinci Resolve, or CapCut. It carries the media, the tracks, and the timing straight from your HJEN Studio timeline.",
          "Choose XML whenever a project still needs a grade, a sound pass, or VFX work. The XML holds the edit decisions; the media folder holds the shots themselves."
        ],
        "videos": [
          "exportXML.mp4"
        ]
      }
    ]
  },
  {
    "key": "mcp",
    "title": "Agent setup",
    "pages": [
      {
        "key": "index",
        "title": "MCP Connector",
        "subtitle": "Copy page",
        "paragraphs": [
          "MCP is the shared standard AI assistants use to reach outside tools. HJEN Studio’s connector opens that door, letting a supported assistant work inside your projects under your own account permissions.",
          "Link it a single time, then hand your assistant real work — browsing projects, tidying canvases and subjects, sending up image references, pulling assets down, and running takes you’ve approved. The gentlest way in is Claude Desktop or Claude on the web.",
          "Claude Desktop & Web",
          "RECOMMENDED SETUP",
          "Nothing is quicker than Claude’s own connector settings. Add HJEN Studio once, sign in, and put Claude to work on your projects.",
          "Setup instructions",
          "Setup for other agents",
          "Wire up another supported MCP client.",
          "Claude Code",
          "Advanced setup",
          "Hands-on setup for local, file-based work.",
          "Gemini CLI",
          "Supported",
          "Add the HJEN Studio extension for Gemini CLI.",
          "ChatGPT",
          "Submission ready",
          "Link HJEN Studio into ChatGPT and start talking to your assistant.",
          "OpenClaw",
          "Supported",
          "Register HJEN Studio as a hosted MCP server.",
          "Hermes Agent",
          "Supported",
          "Point it at HJEN Studio's hosted MCP URL.",
          "Cursor",
          "Supported",
          "Add a remote MCP server from its settings.",
          "Other MCP clients",
          "Almost any client connects, provided it speaks hosted MCP or Streamable HTTP.",
          "Setup details",
          "Prompt ideas",
          "Point your connected agent at raw creative material and let it shape it into HJEN Studio structure.",
          "Create a storyboard. “Take this concept into HJEN Studio as a storyboard — build the canvases, drop a shot node for every beat, rough out the prompts, and lay it all in order.”",
          "Break down a script. “Read this script and lay it out in HJEN Studio — characters as subjects, locations as canvases, and variables for the settings, moods, and character notes that keep repeating.”",
          "Build a character library. “Make a subject for each recurring character in this treatment, give each a tight visual description, and cluster their references so I can pull them into any canvas.”",
          "Draft a run of takes. “For this sequence, propose the model, prompt, subject bindings, and number of takes per shot, and hold it for my review before anything is sent.”",
          "Review and organize a project. “Comb this project for missing subjects, mismatched names, duplicate references, and muddled shot order, then propose a cleaner board.”",
          "What you can do",
          "#",
          "HJEN Studio’s MCP tools span the core things an assistant does inside a project:",
          "Browse projects. Read out your projects, canvases, subjects, and assets, and reach for the finer metadata when you need it.",
          "Organize the canvas. Open canvases, build reusable subjects (characters, props, animals), and add or shift objects around the board.",
          "Upload images. Push as many as 50 at once straight onto a canvas. Audio and video still come in through the HJEN Studio app for the moment.",
          "Run approved takes. On the full connector, your assistant can make media for existing or freshly planned shots once you’ve signed off on the model, the prompt, the count, and the estimated credit cost.",
          "The same account limits hold over MCP: an assistant can only touch the projects, assets, credits, and actions your account already reaches, and making anything still waits on your approval.",
          "Show tool inventory",
          "Safety & security",
          "#",
          "Billing guards",
          "Anything that would draw down Olive Credits waits for your clear yes before a single credit is spent. HJEN Studio keeps enforcing your permissions, your balance, your spend limits, provider limits, rate limits, and content rules underneath it all.",
          "Connector profiles",
          "The full profile at https://www.hjen.studio/mcp carries approved image and video making. The core profile at https://www.hjen.studio/mcp-core holds the everyday project, board, canvas, subject, upload, download, review, and organization tools while leaving the direct making tools out.",
          "What data is shared",
          "Whatever reaches your MCP client travels through tool-call requests and their responses. Those calls can carry project names, the shape of a canvas, asset metadata and previews, subject details, prompts, model settings, job status, and short-lived storage links.",
          "Policies",
          "Using the connector falls under HJEN Studio’s Terms of Service and Privacy Policy. Jobs that make media may also answer to the terms of the outside model providers.",
          "Troubleshooting",
          "#",
          "“Origin not allowed”",
          "For requests coming from a browser, the connector checks the Origin header. If your browser-based client lives on a domain other than claude.ai or claude.com, drop a line to support@hjen.studio and we’ll add you to the allowlist.",
          "An upload or download fails with a network error",
          "When you reach HJEN Studio from somewhere with locked-down egress (e.g. a sandbox), R2 can be shut off for both uploads (PUT) and downloads (GET). Run the check_storage_reachability tool first — it hands back a probe URL and a fix you can follow.",
          "Support",
          "#",
          "Questions, bugs, and feature ideas go to support@hjen.studio. Partnership and integration notes go to hello@hjen.studio.",
          "There’s more on our support and security pages."
        ],
        "videos": []
      },
      {
        "key": "claude",
        "title": "Claude Desktop & Web setup",
        "subtitle": "Recommended",
        "paragraphs": [
          "Copy page",
          "Set HJEN Studio up from Claude’s connector settings.",
          "Setup",
          "#",
          "1",
          "Open connector settings",
          "Go to Claude’s connector settings, in Desktop or on the web:",
          "Open in Claude Desktop",
          "Open in Claude Web",
          "Or launch Claude Desktop or Claude on the web and head to Settings → Connectors → Customize.",
          "2",
          "Choose Add custom connector",
          "Press the + beside Connectors and pick Add custom connector.",
          "3",
          "Enter HJEN Studio connector details",
          "Fill in HJEN Studio as the custom connector:",
          "NAME",
          "HJEN Studio",
          "URL",
          "https://www.hjen.studio/mcp",
          "Press Add once both fields are set.",
          "4",
          "Set tool permissions",
          "We’d set read-only tools to Always allow and anything that writes or deletes to Needs approval.",
          "5",
          "Verify in a new chat",
          "Open a fresh chat and ask “show me my latest projects”. Sign in to HJEN Studio when Claude asks.",
          "Verify connection",
          "#",
          "Ask “show me my latest projects.”",
          "Approve those first tool calls only once the client is clearly pointing at the HJEN Studio project or asset you expect.",
          "Disconnect or revoke",
          "#",
          "In Claude Desktop, go to Settings → Connectors, locate HJEN Studio, and disconnect.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      },
      {
        "key": "claude-code",
        "title": "Claude Code setup",
        "subtitle": "Advanced setup",
        "paragraphs": [
          "Copy page",
          "Hands-on setup for local, file-based work.",
          "Setup",
          "#",
          "Claude Code setup",
          "Start by installing the HJEN Studio skill:",
          "npx -y skills add github.com/hjen-studio/skills --global --agent claude-code --yes",
          "Now add the HJEN Studio MCP connector:",
          "claude mcp add --transport http --scope user hjen https://www.hjen.studio/mcp",
          "Run both commands in your terminal.",
          "In Claude Code, run /mcp.",
          "Sign in to HJEN Studio when the browser prompt appears.",
          "Ask “show me my latest projects.”",
          "Core profile",
          "To put the slimmer core profile in its place, use:",
          "claude mcp add --transport http --scope user hjen-core https://www.hjen.studio/mcp-core",
          "Verify connection",
          "#",
          "Ask “show me my latest projects.”",
          "Approve those first tool calls only once the client is clearly pointing at the HJEN Studio project or asset you expect.",
          "Disconnect or revoke",
          "#",
          "Drop HJEN Studio from Claude Code’s user-scoped MCP servers:",
          "claude mcp remove hjen --scope user",
          "If you also added the core profile, pull hjen-core the same way.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      },
      {
        "key": "chatgpt",
        "title": "ChatGPT setup",
        "subtitle": "Submission ready",
        "paragraphs": [
          "Copy page",
          "Link HJEN Studio into ChatGPT and start talking to your assistant.",
          "Setup",
          "#",
          "Open ChatGPT → Settings → Apps → Add more",
          "Open ChatGPT Apps",
          "Search apps: HJEN Studio → Click Connect",
          "Sign in with HJEN Studio / Use without an Account",
          "Complete authorization",
          "Return to ChatGPT and start chatting",
          "Verify connection",
          "#",
          "Ask “show me my latest projects.”",
          "Approve those first tool calls only once the client is clearly pointing at the HJEN Studio project or asset you expect.",
          "Disconnect or revoke",
          "#",
          "In ChatGPT, head to Settings → Connectors, choose HJEN Studio, and disconnect or delete it.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      },
      {
        "key": "cursor",
        "title": "Cursor setup",
        "subtitle": "Supported",
        "paragraphs": [
          "Copy page",
          "Add a remote MCP server from its settings.",
          "Setup",
          "#",
          "Open Cursor’s settings and go to MCP.",
          "Add a new remote MCP server with https://www.hjen.studio/mcp as the URL. If Cursor asks for a transport, pick Streamable HTTP.",
          "Sign in to HJEN Studio when Cursor opens the OAuth flow.",
          "If you’d rather set it up in a file, add HJEN Studio to ~/.cursor/mcp.json for everything, or to .cursor/mcp.json inside a single project:",
          "{",
          "\"mcpServers\": {",
          "\"hjen\": {",
          "\"url\": \"https://www.hjen.studio/mcp\"",
          "}",
          "}",
          "}",
          "Restart Cursor, or reload its MCP servers, after you save the file.",
          "Verify connection",
          "#",
          "Ask “show me my latest projects.”",
          "Approve those first tool calls only once the client is clearly pointing at the HJEN Studio project or asset you expect.",
          "Disconnect or revoke",
          "#",
          "In Cursor, take HJEN Studio out of the MCP settings. If it went into ~/.cursor/mcp.json or .cursor/mcp.json, delete the HJEN Studio entry and reload the MCP servers.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      },
      {
        "key": "gemini-cli",
        "title": "Gemini CLI setup",
        "subtitle": "Supported",
        "paragraphs": [
          "Copy page",
          "Add the HJEN Studio extension for Gemini CLI.",
          "Setup",
          "#",
          "Install Gemini CLI first if it isn’t already on your machine.",
          "Add HJEN Studio’s Gemini CLI extension:",
          "gemini extensions install https://github.com/hjen-studio/mcp --auto-update",
          "Restart Gemini CLI, run /mcp, then run /mcp auth hjen if it prompts you to sign in.",
          "Verify connection",
          "#",
          "Ask “show me my latest projects.”",
          "Approve those first tool calls only once the client is clearly pointing at the HJEN Studio project or asset you expect.",
          "Disconnect or revoke",
          "#",
          "Pull the HJEN Studio extension or MCP server out of your Gemini configuration, then wipe any locally cached HJEN Studio auth token if Gemini lets you manage tokens.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      },
      {
        "key": "hermes-agent",
        "title": "Hermes Agent setup",
        "subtitle": "Supported",
        "paragraphs": [
          "Copy page",
          "Point it at HJEN Studio's hosted MCP URL.",
          "Setup",
          "#",
          "From a terminal, run:",
          "hermes update",
          "hermes mcp add hjen --url https://www.hjen.studio/mcp --auth oauth",
          "hermes mcp test hjen",
          "If Hermes doesn’t pop a browser after you add HJEN Studio, run:",
          "hermes mcp login hjen",
          "Once the test clears, open a new Hermes session and ask:",
          "Use the hjen MCP and show me my latest projects.",
          "Disconnect or revoke",
          "#",
          "In Hermes Agent, take HJEN Studio out of the MCP servers or connector settings.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      },
      {
        "key": "openclaw",
        "title": "OpenClaw setup",
        "subtitle": "Supported",
        "paragraphs": [
          "Copy page",
          "Register HJEN Studio as a hosted MCP server.",
          "Setup",
          "#",
          "From a terminal, run:",
          "openclaw mcp add hjen --url https://www.hjen.studio/mcp --transport streamable-http --auth oauth",
          "openclaw mcp login hjen",
          "openclaw mcp doctor hjen --probe",
          "If OpenClaw wants an authorization code after the browser sign-in, run:",
          "openclaw mcp login hjen --code <PASTE_CODE>",
          "Once the probe clears, open a new OpenClaw session and ask:",
          "Use the hjen MCP and show me my latest projects.",
          "Disconnect or revoke",
          "#",
          "In OpenClaw, take HJEN Studio out of the MCP servers or integrations settings.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      },
      {
        "key": "other-clients",
        "title": "Other MCP clients",
        "subtitle": "MCP compatible",
        "paragraphs": [
          "Copy page",
          "Almost any client connects, provided it speaks hosted MCP or Streamable HTTP.",
          "Setup",
          "#",
          "Add HJEN Studio to any compatible MCP client with the full connector URL:",
          "https://www.hjen.studio/mcp",
          "When your client asks for a transport, choose Streamable HTTP or hosted HTTP.",
          "The slimmer core profile lives at:",
          "https://www.hjen.studio/mcp-core",
          "Verify connection",
          "#",
          "Ask “show me my latest projects.”",
          "Approve those first tool calls only once the client is clearly pointing at the HJEN Studio project or asset you expect.",
          "Disconnect or revoke",
          "#",
          "Take HJEN Studio off your client’s MCP server list. If that client keeps OAuth tokens on their own, revoke or delete the HJEN Studio token there as well.",
          "Troubleshooting",
          "#",
          "If it won’t connect, check that the server URL reads https://www.hjen.studio/mcp, reload the client’s MCP servers, and sign in once more. For anything browser-based, confirm the client’s domain clears HJEN Studio’s MCP origin policy.",
          "Back to MCP overview",
          "Compare all clients"
        ],
        "videos": []
      }
    ]
  },
  {
    "key": "teams",
    "title": "Teams",
    "pages": [
      {
        "key": "overview",
        "title": "Overview",
        "subtitle": "Shared workspaces built for a studio.",
        "paragraphs": [
          "A team is a shared workspace for a studio or an agency. Everyone on it shares billing, the model-access settings, and ownership of the projects. Admins decide who gets in, which models are on offer, and how far each member can spend.",
          "Start a team from your account settings and invite people by email. Any project made inside it is open to every member and pulls from the team's shared credits."
        ],
        "videos": []
      },
      {
        "key": "members",
        "title": "Members and roles",
        "subtitle": "Invites and who can do what.",
        "paragraphs": [
          "Bring members in by email. Admins add and remove people, shape the team's settings, and hold the reins on spend. Members work in the shared projects and bill against the team.",
          "If someone leaves, the work they made stays put. Nothing goes with them."
        ],
        "videos": []
      },
      {
        "key": "models",
        "title": "Managing models",
        "subtitle": "Switch models on or off for the whole team.",
        "paragraphs": [
          "Admins can turn individual models on or off. When one runs expensive or shaky for the work you do, switch it off and it drops out of everyone's picker.",
          "That keeps the panel lean and the spend steady. The list is never fixed — change it whenever from team settings."
        ],
        "videos": []
      },
      {
        "key": "billing",
        "title": "Team billing",
        "subtitle": "One bill, with caps per member.",
        "paragraphs": [
          "A team runs on a single billing account. The plan covers everyone, and all of it comes out of one credit balance. Admins can cap each member's spend to keep costs in hand.",
          "The history and the invoices split spend out by member and by project, so it's clear exactly where every credit went."
        ],
        "videos": []
      }
    ]
  },
  {
    "key": "account",
    "title": "Account",
    "pages": [
      {
        "key": "profile",
        "title": "Profile",
        "subtitle": "Your handle and your email.",
        "paragraphs": [
          "Your handle is how you show up across HJEN Studio — on project cursors, in shared work, and in the account menu. Your email carries the login, the billing receipts, and any team invites.",
          "Edit either one from the account settings page."
        ],
        "videos": []
      },
      {
        "key": "preferences",
        "title": "Preferences",
        "subtitle": "Tucked-away models and workflow choices.",
        "paragraphs": [
          "Tuck any model you never reach for out of the model panel. These choices belong to your account and travel with you across every project and team.",
          "If Veo and Kling are all you use, hide everything else. The panel clears up and you stop scrolling past models you'd never choose."
        ],
        "videos": []
      },
      {
        "key": "billing",
        "title": "Billing",
        "subtitle": "Your plan, your credits, and every transaction and invoice.",
        "paragraphs": [
          "The billing page shows your plan, your credit balance, and everything you've spent. Move up, move down, or top up whenever you like, and pull down invoices while you're there.",
          "The breakdowns sort spend by project, so you always know where the credits landed. On a team, the billing sits with the admin instead."
        ],
        "videos": []
      }
    ]
  },
  {
    "key": "shortcuts",
    "title": "Keyboard shortcuts",
    "pages": [
      {
        "key": "index",
        "title": "Keyboard Shortcuts",
        "subtitle": "These shortcuts keep your hands on the keys and off the menus. They're gathered by the kind of work each one supports.",
        "paragraphs": [
          "CREATE",
          "Place text annotation",
          "T",
          "Place image",
          "I",
          "Place video shot",
          "V",
          "Place audio",
          "A",
          "Place subject",
          "S",
          "Place bin",
          "B",
          "Place set",
          "⇧",
          "S",
          "Place variable",
          "⇧",
          "V",
          "SELECTION",
          "Select all",
          "⌘",
          "A",
          "Deselect all",
          "Esc",
          "PLAYBACK",
          "Play / pause",
          "␣",
          "Scrub backward / stop / forward",
          "J",
          "/",
          "K",
          "/",
          "L",
          "Jump to start / end",
          "Home",
          "/",
          "End",
          "Step one frame",
          "←",
          "/",
          "→",
          "CAMERA AND VIEWPORT",
          "Fit all in view",
          "F",
          "Zoom to selection",
          "⇧",
          "Z",
          "Center on selection",
          ".",
          "Zoom in",
          "+",
          "Zoom out",
          "-",
          "Reset zoom to 100%",
          "0",
          "CLIPBOARD",
          "Copy",
          "⌘",
          "C",
          "Cut",
          "⌘",
          "X",
          "Paste",
          "⌘",
          "V",
          "DUPLICATE",
          "Duplicate",
          "⌘",
          "D",
          "Duplicate with settings",
          "⌘",
          "⇧",
          "D",
          "RATING AND LABELS",
          "Toggle reject",
          "R",
          "Toggle favorite",
          "F",
          "Upscale & Enhance shot",
          "U",
          "Apply color label",
          "1",
          "–",
          "5",
          "Clear color label",
          "0",
          "Toggle filter overlay",
          "⇧",
          "F",
          "UNDO AND REDO",
          "Undo / redo",
          "⌘",
          "Z",
          "/",
          "⌘",
          "⇧",
          "Z",
          "RENAME",
          "Rename object",
          "Enter",
          "/",
          "Esc",
          "STACKS",
          "Cycle through stack",
          "⌥",
          "ArrowLeft/Alt",
          "→",
          "SET VIEWER",
          "Navigate set viewer",
          "WASD",
          "/",
          "QE",
          "/",
          "␣",
          "DELETE",
          "Delete selected",
          "⌫"
        ],
        "videos": []
      }
    ]
  }
];
