/**
 * PIXAL2.0 — PDF & Chart generation templates
 * Used by the pdf_generate tool. Injected into sandbox Python code.
 */

/* eslint-disable no-useless-escape */

export const SKILL_PDF_GENERATION = `## PDF Generation Skill

### Font Setup (include at top of EVERY PDF script)

\`\`\`python
import os, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties

_FONT_CANDIDATES = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/arphic/uming.ttc',
]
_font_path = next((p for p in _FONT_CANDIDATES if os.path.exists(p)), None)
font = FontProperties(fname=_font_path) if _font_path else FontProperties()
font_bold = FontProperties(fname=_font_path, weight='bold') if _font_path else FontProperties(weight='bold')
COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2', '#e11d48', '#4f46e5']
\`\`\`

### Multi-page PDF Report Template

\`\`\`python
import os, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.font_manager import FontProperties
import numpy as np

# ... font setup as above ...

with PdfPages('/tmp/report.pdf') as pdf:
    # Cover page
    fig, ax = plt.subplots(figsize=(8.27, 11.69))
    ax.axis('off')
    ax.text(0.5, 0.92, 'Report Title', fontsize=28, fontproperties=font_bold, ha='center', color='#1e40af')
    pdf.savefig(fig); plt.close()

    # Data page
    fig, ax = plt.subplots(figsize=(8.27, 11.69))
    ax.axis('off')
    ax.text(0.5, 0.96, 'Data', fontsize=18, fontproperties=font_bold, ha='center')
    # ... add table, charts, etc.
    pdf.savefig(fig); plt.close()

print("PDF generated: /tmp/report.pdf")
\`\`\`

### Important Rules
- ALWAYS include the full font probe block
- For ANY CJK content, use matplotlib + PdfPages (NOT fpdf2)
- After print("PDF generated..."), call deliver_file immediately
`;
