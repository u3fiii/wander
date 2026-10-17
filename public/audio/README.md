# Car audio files

Read by `src/game/audio.ts`. Each name can be `.mp3`, `.ogg`, `.wav` or `.m4a` (tried in that order, so a file
you add as `.mp3` replaces the `.m4a` default). Every one is optional: a missing file falls back to synthesised
sound.

| Name | Kind | Used for |
| --- | --- | --- |
| `engine` | loop | The engine. Its speed follows the rpm. A steady, low recording works best. |
| `engine-load` | loop | Layered on top while on the throttle. Without it the engine loop is reused, a little higher. |
| `engine-start` | one-shot | When a drive starts. |
| `offroad` | loop | Gravel / rumble while off the road. |
| `boost` | one-shot | When a boost fires. |
| `thud` | one-shot | Landing on or off the road. |

Until an `engine` file is here, a synthesised engine plays. For the engine, use a recording of the engine itself
from outside the car at a steady rpm (an interior recording is mostly road and wind noise).
