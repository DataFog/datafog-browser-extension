"""Rebuild synthetic fixtures: python with reportlab and pillow installed."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont
out = Path(__file__).resolve().parents[1] / 'e2e/pdf-fixtures'
out.mkdir(exist_ok=True)
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
font = ImageFont.truetype(font_path, 40)
lines = ['123 Main Street', 'Unit 4', 'Springfield, IL 62704']
image = Image.new('RGB',(1100,260),'white')
draw = ImageDraw.Draw(image)
for i,line in enumerate(lines): draw.text((20,15+i*75),line,fill='black',font=font)
for kind in ['native','scanned','mixed']:
    c = canvas.Canvas(str(out / (kind+'.pdf')),pagesize=(612,792),invariant=1)
    c.setFont('Helvetica',18)
    if kind != 'scanned':
        c.drawString(40,740,'Jane met Zoë García today.')
        c.drawString(40,705,'jane@example.com')
    if kind=='native':
        for i,line in enumerate(lines): c.drawString(40,650-i*30,line)
    elif kind=='mixed': c.drawImage(ImageReader(image),40,500,width=500,height=118)
    else:
        full=Image.new('RGB',(1224,1584),'white'); d=ImageDraw.Draw(full)
        for i,line in enumerate(['Jane met Zoë García today.','jane@example.com']+lines):d.text((80,90+i*100),line,fill='black',font=font)
        c.drawImage(ImageReader(full),0,0,width=612,height=792)
    c.showPage(); c.save()
(out/'corrupt.pdf').write_bytes(b'%PDF-1.7\nnot a valid PDF')
c=canvas.Canvas(str(out/'encrypted.pdf'),encrypt='test-password',invariant=1)
c.drawString(40,740,'jane@example.com');c.save()
(out/'gold.txt').write_text('Jane met Zoë García today.\njane@example.com\n123 Main Street\nUnit 4\nSpringfield, IL 62704\n')
