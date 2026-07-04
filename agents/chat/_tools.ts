/**
 * Tool definitions & executors for PIXAL2.0
 * ==========================================
 * Expanded toolset: code_interpreter, shell, files, deliver_file,
 * image_process, audio_process, video_process, data_analysis,
 * pdf_generate, web_fetch, qr_code, translate, file_convert, suggest_actions.
 * All tool execution happens in the EdgeOne sandbox.
 */

/** Shell-safe single-quote wrapping */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Tool call interface */
export interface ToolCall {
  tool: string;
  arguments: Record<string, any>;
}

/** Tool result interface */
export interface ToolResult {
  success: boolean;
  output: string;
  file?: string; // path to deliverable file if any
}

/** Sandbox interface (EdgeOne Makers) */
interface Sandbox {
  commands?: {
    run(cmd: string, opts?: any): Promise<{ stdout: string; stderr: string; exitCode?: number }>;
  };
  files?: {
    write(path: string, content: string): Promise<void>;
    read(path: string): Promise<string>;
    list(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
    makeDir(path: string): Promise<void>;
  };
  runCode?(code: string, opts?: { language?: string }): Promise<{ stdout: string; stderr: string }>;
}

/** Text file extensions */
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.css',
  '.js', '.ts', '.tsx', '.py', '.log', '.yml', '.yaml', '.sql',
]);

/** Check if a file can be safely inlined as UTF-8 text */
export function canInlineFallbackFile(fileName: string, content: Buffer): boolean {
  const lowerName = fileName.toLowerCase();
  const extension = lowerName.includes('.')
    ? lowerName.slice(lowerName.lastIndexOf('.'))
    : '';
  if (!TEXT_EXTENSIONS.has(extension)) return false;
  if (content.includes(0)) return false;
  const decoded = content.toString('utf8');
  const replacementCount = decoded.match(/\uFFFD/g)?.length ?? 0;
  return replacementCount / Math.max(decoded.length, 1) < 0.01;
}

/** Get file type from filename */
export function getFileType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tiff'].includes(ext)) return 'image';
  if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'm4v'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus'].includes(ext)) return 'audio';
  if (['pdf'].includes(ext)) return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['xls', 'xlsx'].includes(ext)) return 'excel';
  if (['csv'].includes(ext)) return 'csv';
  return 'text';
}

/** Check if a file type is multimodal */
export function isMultimodal(fileType: string): boolean {
  return ['image', 'video', 'audio'].includes(fileType);
}

/** Sandbox setup: install packages & make filesystem writable */
export async function setupSandbox(sandbox: Sandbox): Promise<boolean> {
  if (!sandbox?.commands) return false;

  const runCmd = async (cmd: string, timeout = 60): Promise<string> => {
    try {
      const r = await sandbox.commands!.run(cmd, { timeout });
      return r.stdout || '';
    } catch {
      return '';
    }
  };

  try {
    // Make /tmp writable (should already be, but ensure)
    await runCmd('chmod -R 777 /tmp 2>/dev/null; mkdir -p /tmp/pixal_work && chmod 777 /tmp/pixal_work');

    // Check if packages are already installed
    const checkResult = await runCmd('python3 -c "import transformers; print(\'ok\')" 2>/dev/null');

    if (checkResult.trim() !== 'ok') {
      // Install all required packages
      const installCmd = `pip install --quiet --no-cache-dir \
        transformers huggingface_hub torch accelerate \
        Pillow opencv-python-headless pandas openpyxl \
        PyPDF2 pdfplumber python-docx fpdf2 matplotlib numpy scipy \
        scikit-learn librosa soundfile beautifulsoup4 qrcode \
        pydub openai-whisper sentencepiece protobuf einops \
        bitsandbytes requests 2>&1 | tail -5`;

      await runCmd(installCmd, 300);
    }

    // Verify ffmpeg is available
    await runCmd('which ffmpeg || (apt-get update -qq && apt-get install -y -qq ffmpeg 2>/dev/null) || true');

    return true;
  } catch {
    return false;
  }
}

/** Process multimodal files in sandbox using Python */
export async function processMultimodalInSandbox(
  sandbox: Sandbox,
  fileName: string,
  fileType: string
): Promise<string> {
  if (!sandbox?.runCode) return `[File: ${fileName} (type: ${fileType}) - sandbox not available for processing]`;

  const filePath = `/tmp/${fileName}`;

  try {
    if (fileType === 'image') {
      // Image analysis using PIL
      const code = `
from PIL import Image
import os
img = Image.open('${filePath}')
print(f"Image: {img.format}, size={img.size}, mode={img.mode}")
print(f"File size: {os.path.getsize('${filePath}')} bytes")
# Basic image description
w, h = img.size
mode = img.mode
print(f"Dimensions: {w}x{h}")
print(f"Color mode: {mode}")
# Get dominant colors
img_small = img.resize((100, 100))
colors = img_small.getcolors(10000)
if colors:
    colors.sort(key=lambda x: x[0], reverse=True)
    top = colors[:5]
    print(f"Top colors: {[(c[0], c[1]) for c in top]}")
print("IMAGE_ANALYSIS_DONE")
`;
      const result = await sandbox.runCode(code, { language: 'python' });
      return result.stdout || `[Image file: ${fileName}]`;
    }

    if (fileType === 'audio') {
      // Audio analysis using librosa
      const code = `
import librosa
import soundfile as sf
import os
y, sr = librosa.load('${filePath}', sr=None)
duration = len(y) / sr
print(f"Audio: duration={duration:.2f}s, sample_rate={sr}")
print(f"Channels: mono" if y.ndim == 1 else f"Channels: stereo")
print(f"File size: {os.path.getsize('${filePath}')} bytes")
# Basic audio features
tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
print(f"Tempo: {tempo:.1f} BPM")
print("AUDIO_ANALYSIS_DONE")
`;
      try {
        const result = await sandbox.runCode(code, { language: 'python' });
        return result.stdout || `[Audio file: ${fileName}]`;
      } catch {
        // Fallback: basic info
        const fallbackCode = `
import os
size = os.path.getsize('${filePath}')
print(f"Audio file: ${'${fileName}'}, size={size} bytes")
`;
        const result = await sandbox.runCode(fallbackCode, { language: 'python' });
        return result.stdout || `[Audio file: ${fileName}]`;
      }
    }

    if (fileType === 'video') {
      // Video analysis using ffmpeg/ffprobe
      const code = `
import subprocess, json, os
result = subprocess.run(
    ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '${filePath}'],
    capture_output=True, text=True
)
info = json.loads(result.stdout)
stream = info.get('streams', [{}])[0]
fmt = info.get('format', {})
print(f"Video: {fmt.get('duration', 'unknown')}s, {stream.get('width', '?')}x{stream.get('height', '?')}")
print(f"Codec: {stream.get('codec_name', 'unknown')}")
print(f"File size: {os.path.getsize('${filePath}')} bytes")
print("VIDEO_ANALYSIS_DONE")
`;
      try {
        const result = await sandbox.runCode(code, { language: 'python' });
        return result.stdout || `[Video file: ${fileName}]`;
      } catch {
        return `[Video file: ${fileName}]`;
      }
    }

    return `[File: ${fileName}]`;
  } catch (e) {
    return `[Error processing ${fileName}: ${(e as Error).message}]`;
  }
}

/** Execute a tool call in the sandbox */
export async function executeTool(
  toolCall: ToolCall,
  sandbox: Sandbox | null
): Promise<ToolResult> {
  const { tool, arguments: args } = toolCall;

  if (!sandbox) {
    return { success: false, output: `Sandbox not available for tool: ${tool}` };
  }

  try {
    switch (tool) {
      case 'code_interpreter': {
        const lang = args.language || 'python';
        if (sandbox.runCode) {
          const result = await sandbox.runCode(args.code, { language: lang });
          return { success: true, output: result.stdout || result.stderr || '(no output)' };
        }
        // Fallback: use commands to run python
        if (sandbox.commands) {
          const escaped = args.code.replace(/'/g, "'\\''");
          const r = await sandbox.commands.run(`python3 -c '${escaped}'`, { timeout: 120 });
          return { success: true, output: r.stdout || r.stderr || '(no output)' };
        }
        return { success: false, output: 'No code execution method available' };
      }

      case 'shell': {
        if (!sandbox.commands) return { success: false, output: 'Shell not available' };
        const r = await sandbox.commands.run(args.command, { timeout: 120 });
        return { success: true, output: r.stdout || r.stderr || '(no output)' };
      }

      case 'files': {
        if (!sandbox.files) return { success: false, output: 'File operations not available' };
        const op = args.op;
        switch (op) {
          case 'read':
            const content = await sandbox.files.read(args.path);
            return { success: true, output: content };
          case 'write':
            await sandbox.files.write(args.path, args.content || '');
            return { success: true, output: `Written to ${args.path}` };
          case 'list':
            const items = await sandbox.files.list(args.path);
            return { success: true, output: items.join('\n') };
          case 'exists':
            const exists = await sandbox.files.exists(args.path);
            return { success: true, output: exists ? 'true' : 'false' };
          case 'remove':
            await sandbox.files.remove(args.path);
            return { success: true, output: `Removed ${args.path}` };
          case 'makeDir':
            await sandbox.files.makeDir(args.path);
            return { success: true, output: `Created dir ${args.path}` };
          default:
            return { success: false, output: `Unknown file op: ${op}` };
        }
      }

      case 'deliver_file': {
        const path = args.path || '';
        const filename = args.filename || path.split('/').pop() || 'file';
        return { success: true, output: `File ready for delivery: ${filename}`, file: path };
      }

      case 'image_process': {
        const code = `
from PIL import Image, ImageDraw, ImageFont
import io, base64

input_path = '${args.input || '/tmp/input.jpg'}'
operation = '${args.operation || 'analyze'}'
params = ${JSON.stringify(args.params || {})}

img = Image.open(input_path)

if operation == 'resize':
    w, h = params.get('width', 800), params.get('height', 600)
    img = img.resize((w, h), Image.LANCZOS)
    output = '/tmp/output_resized.png'
    img.save(output)
    print(f"Resized to {w}x{h}, saved to {output}")
elif operation == 'convert':
    fmt = params.get('format', 'PNG')
    output = f'/tmp/output_converted.{fmt.lower()}'
    img.save(output, format=fmt)
    print(f"Converted to {fmt}, saved to {output}")
elif operation == 'compress':
    quality = params.get('quality', 85)
    output = '/tmp/output_compressed.jpg'
    img.save(output, 'JPEG', quality=quality, optimize=True)
    print(f"Compressed with quality={quality}, saved to {output}")
elif operation == 'crop':
    left, top, right, bottom = params.get('box', [0, 0, img.width//2, img.height//2])
    img = img.crop((left, top, right, bottom))
    output = '/tmp/output_cropped.png'
    img.save(output)
    print(f"Cropped, saved to {output}")
elif operation == 'watermark':
    text = params.get('text', 'PIXAL2.0')
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), text, fill=(255, 255, 255, 128))
    output = '/tmp/output_watermarked.png'
    img.save(output)
    print(f"Watermark added, saved to {output}")
else:  # analyze
    print(f"Image: {img.format}, size={img.size}, mode={img.mode}")
    output = None
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'audio_process': {
        const code = `
import librosa
import soundfile as sf
import subprocess
import os

input_path = '${args.input || '/tmp/audio.wav'}'
operation = '${args.operation || 'analyze'}'

if operation == 'transcribe':
    try:
        import whisper
        model = whisper.load_model('base')
        result = model.transcribe(input_path)
        print(f"Transcription: {result['text']}")
    except ImportError:
        # Fallback: basic info
        y, sr = librosa.load(input_path, sr=None)
        duration = len(y) / sr
        print(f"Audio duration: {duration:.2f}s (whisper not installed for transcription)")
elif operation == 'analyze':
    y, sr = librosa.load(input_path, sr=None)
    duration = len(y) / sr
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    print(f"Duration: {duration:.2f}s, Sample rate: {sr}, Tempo: {tempo:.1f} BPM")
elif operation == 'convert':
    target = '${args.params?.format || 'wav'}'
    output = f'/tmp/output_converted.{target}'
    y, sr = librosa.load(input_path, sr=None)
    sf.write(output, y, sr)
    print(f"Converted to {target}, saved to {output}")
else:
    print(f"Unknown audio operation: {operation}")
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'video_process': {
        const code = `
import subprocess, json, os

input_path = '${args.input || '/tmp/video.mp4'}'
operation = '${args.operation || 'analyze'}'

if operation == 'extract_frames':
    output_dir = '/tmp/frames'
    os.makedirs(output_dir, exist_ok=True)
    subprocess.run(['ffmpeg', '-i', input_path, '-vf', 'fps=1', f'{output_dir}/frame_%04d.jpg'], 
                   capture_output=True)
    frames = os.listdir(output_dir)
    print(f"Extracted {len(frames)} frames to {output_dir}")
elif operation == 'extract_audio':
    output = '/tmp/extracted_audio.wav'
    subprocess.run(['ffmpeg', '-i', input_path, '-vn', '-acodec', 'pcm_s16le', output],
                   capture_output=True)
    print(f"Audio extracted to {output}")
elif operation == 'compress':
    output = '/tmp/output_compressed.mp4'
    subprocess.run(['ffmpeg', '-i', input_path, '-crf', '28', '-preset', 'fast', output],
                   capture_output=True)
    print(f"Compressed video saved to {output}")
elif operation == 'convert':
    target = '${args.params?.format || 'mp4'}'
    output = f'/tmp/output_converted.{target}'
    subprocess.run(['ffmpeg', '-i', input_path, output], capture_output=True)
    print(f"Converted to {target}, saved to {output}")
else:
    result = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input_path],
        capture_output=True, text=True
    )
    info = json.loads(result.stdout)
    s = info.get('streams', [{}])[0]
    print(f"Video: {s.get('width','?')}x{s.get('height','?')}, codec={s.get('codec_name','?')}, duration={info.get('format',{}).get('duration','?')}s")
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'data_analysis': {
        const code = `
import pandas as pd

input_path = '${args.input || '/tmp/data.csv'}'
operation = '${args.operation || 'summary'}'

df = pd.read_csv(input_path)

if operation == 'summary':
    print(df.describe().to_string())
    print(f"\\nShape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
elif operation == 'stats':
    print(df.describe().to_string())
elif operation == 'visualize':
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    df.hist(figsize=(10, 6))
    plt.tight_layout()
    plt.savefig('/tmp/data_visualization.png', dpi=150)
    print("Visualization saved to /tmp/data_visualization.png")
elif operation == 'correlate':
    print(df.corr(numeric_only=True).to_string())
else:
    print(df.head().to_string())
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'pdf_generate': {
        const code = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.font_manager import FontProperties
import textwrap

title = '''${(args.title || 'Report').replace(/'/g, "\\'")}'''
content = '''${(args.content || '').replace(/'/g, "\\'")}'''
output = '${args.output || '/tmp/report.pdf'}'

_font_candidates = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
]
_font_path = next((p for p in _font_candidates if os.path.exists(p)), None) if 'os' in dir() else None
try:
    import os
    _font_path = next((p for p in _font_candidates if os.path.exists(p)), None)
except:
    _font_path = None
font = FontProperties(fname=_font_path) if _font_path else FontProperties()
font_bold = FontProperties(fname=_font_path, weight='bold') if _font_path else FontProperties(weight='bold')

with PdfPages(output) as pdf:
    fig, ax = plt.subplots(figsize=(8.27, 11.69))
    ax.axis('off')
    ax.add_patch(plt.Rectangle((0, 0.92), 1, 0.08, transform=ax.transAxes, color='#1e40af'))
    ax.text(0.5, 0.96, title, fontsize=22, fontproperties=font_bold, ha='center', va='center', color='white')
    y = 0.88
    for line in content.split('\\n'):
        wrapped = textwrap.wrap(line, width=60) or ['']
        for wl in wrapped:
            if y < 0.05: break
            ax.text(0.06, y, wl, fontsize=10, fontproperties=font, va='top')
            y -= 0.022
        y -= 0.008
    pdf.savefig(fig)
    plt.close()

print(f"PDF generated: {output}")
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr, file: args.output || '/tmp/report.pdf' };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'web_fetch': {
        const code = `
import requests
from bs4 import BeautifulSoup

url = '${args.url || ''}'
response = requests.get(url, timeout=15)
soup = BeautifulSoup(response.text, 'html.parser')
text = soup.get_text(separator='\\n', strip=True)
print(text[:3000])
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'qr_code': {
        const code = `
import qrcode
img = qrcode.make('${(args.data || '').replace(/'/g, "\\'")}')
output = '${args.output || '/tmp/qr.png'}'
img.save(output)
print(f"QR code saved to {output}")
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr, file: args.output || '/tmp/qr.png' };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'translate': {
        // Translation is done by the model itself
        return { success: true, output: `Translation requested for: ${args.text || ''} to ${args.target_lang || 'en'}` };
      }

      case 'file_convert': {
        const code = `
# File conversion logic
input_path = '${args.input || '/tmp/file.docx'}'
target_format = '${args.params?.target_format || args.target_format || 'pdf'}'
output = '${args.output || `/tmp/output_converted.${args.params?.target_format || args.target_format || 'pdf'}`}'

input_ext = input_path.rsplit('.', 1)[-1].lower()

if input_ext in ['doc', 'docx'] and target_format == 'pdf':
    from docx import Document
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.font_manager import FontProperties
    
    doc = Document(input_path)
    text = '\\n'.join([p.text for p in doc.paragraphs])
    
    with PdfPages(output) as pdf:
        fig, ax = plt.subplots(figsize=(8.27, 11.69))
        ax.axis('off')
        ax.text(0.05, 0.95, text[:2000], fontsize=9, va='top', wrap=True)
        pdf.savefig(fig)
        plt.close()
    print(f"Converted to PDF: {output}")

elif input_ext in ['xlsx', 'xls'] and target_format == 'csv':
    import pandas as pd
    df = pd.read_excel(input_path)
    df.to_csv(output, index=False)
    print(f"Converted to CSV: {output}")

elif input_ext == 'csv' and target_format in ['xlsx', 'xls']:
    import pandas as pd
    df = pd.read_csv(input_path)
    df.to_excel(output, index=False)
    print(f"Converted to Excel: {output}")

elif input_ext in ['png', 'jpg', 'jpeg', 'webp', 'bmp'] and target_format in ['png', 'jpg', 'jpeg', 'webp', 'bmp']:
    from PIL import Image
    img = Image.open(input_path)
    if target_format == 'jpg' and img.mode == 'RGBA':
        img = img.convert('RGB')
    img.save(output)
    print(f"Converted to {target_format}: {output}")

else:
    print(f"Conversion from {input_ext} to {target_format} not supported")
`;
        if (sandbox.runCode) {
          const result = await sandbox.runCode(code, { language: 'python' });
          return { success: true, output: result.stdout || result.stderr, file: args.output };
        }
        return { success: false, output: 'Code interpreter not available' };
      }

      case 'suggest_actions': {
        const actions = args.actions || [];
        return { success: true, output: JSON.stringify({ suggestions: actions }) };
      }

      default:
        return { success: false, output: `Unknown tool: ${tool}` };
    }
  } catch (e) {
    return { success: false, output: `Tool execution error: ${(e as Error).message}` };
  }
}

/** Upload file to sandbox */
export async function uploadFileToSandbox(
  sandbox: Sandbox,
  file: { name: string; base64: string }
): Promise<boolean> {
  const sandboxPath = `/tmp/${file.name}`;

  try {
    const runCmd = async (cmd: string): Promise<string> => {
      const r = await sandbox.commands!.run(cmd, { timeout: 30 });
      return r.stdout || '';
    };

    // Strategy 1: write base64 → decode
    try {
      const b64TmpPath = '/tmp/__upload_b64.tmp';
      await sandbox.files!.write(b64TmpPath, file.base64);
      await runCmd(`base64 -d ${b64TmpPath} > ${shellQuote(sandboxPath)} && rm -f ${b64TmpPath}`);
      const sizeStr = await runCmd(`stat -c %s ${shellQuote(sandboxPath)} 2>/dev/null || echo 0`);
      if ((parseInt(sizeStr.trim(), 10) || 0) > 0) return true;
    } catch {}

    // Strategy 2: Python base64 decode
    try {
      if (sandbox.runCode) {
        if (file.base64.length <= 150_000) {
          await sandbox.runCode(
            `import base64\nwith open("${sandboxPath}", "wb") as f:\n    f.write(base64.b64decode("${file.base64}"))\nprint("ok")`,
            { language: 'python' }
          );
          return true;
        } else {
          // Chunked
          const chunkSize = 150_000;
          const totalChunks = Math.ceil(file.base64.length / chunkSize);
          await sandbox.runCode(`open("/tmp/__b64tmp", "w").close()`, { language: 'python' });
          for (let i = 0; i < totalChunks; i++) {
            const chunk = file.base64.slice(i * chunkSize, (i + 1) * chunkSize);
            await sandbox.runCode(`open("/tmp/__b64tmp", "a").write("${chunk}")`, { language: 'python' });
          }
          await sandbox.runCode(
            `import base64\nwith open("/tmp/__b64tmp") as f:\n    d = base64.b64decode(f.read())\nwith open("${sandboxPath}", "wb") as f:\n    f.write(d)\nimport os\nos.remove("/tmp/__b64tmp")\nprint("ok")`,
            { language: 'python' }
          );
          return true;
        }
      }
    } catch {}

    return false;
  } catch {
    return false;
  }
}
