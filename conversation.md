ช่วยสรุปผล

ถ้าจะทำระบบสร้างข้อสอบภาษาอังกฤษจริงจัง แต่ยัง practical ไม่ overengineer — ผมว่าเริ่มที่ “4-6 agents” กำลังดี

มากกว่านี้ complexity จะพุ่งเร็วมากโดยที่ quality ไม่ได้เพิ่มตามทันที

Architecture ที่ balance ดีที่สุด
1. Blueprint Agent

หน้าที่:

ตีโจทย์จาก requirement
กำหนด:
CEFR
skill
question type
target difficulty
grammar focus

เช่น:

B1 Reading
inference question
workplace topic
140-word passage

นี่คือ “สมองต้นน้ำ”

2. Content Generation Agent

สร้าง:

passage
dialogue
grammar stem
listening script

โดยอิง blueprint

3. Distractor Agent

สำคัญมาก

สร้าง:

ตัวลวง
plausible wrong answers

Agent นี้ควร specialized เพราะ distractor คือหัวใจของ MCQ quality

4. Judge / Review Agent

ตรวจ:

ambiguity
CEFR drift
grammar
unintended answers
naturalness
consistency

อันนี้คือ LLM as a Judge

5. Psychometric Agent

ยังไม่ต้อง IRT เต็มก็ได้ตอนแรก

เริ่มจาก:

estimated difficulty
cognitive load
discrimination prediction
readability

พอมี user data ค่อย evolve

6. Assembly Agent

เอาทุกอย่างมาประกอบ:

balance difficulty
balance topic
avoid repetition
construct test form

นี่คือ agent ที่จัด “ชุดข้อสอบ”

ถ้าอยากเริ่มเร็วจริงๆ

เริ่มแค่ 3 agents ก็พอ

Minimal Viable Pipeline
1. Blueprint Agent
2. Generator Agent
3. Judge Agent

แค่นี้ก็เริ่มได้แล้ว

และจริงๆ quality จะดีกว่าระบบ random generate เยอะมาก

สิ่งที่ “ไม่ควร” ทำ
❌ Agent เดียวทำทุกอย่าง

ปัญหา:

consistency ต่ำ
hallucination สูง
CEFR drift เยอะ
review ตัวเองไม่เก่ง
❌ Agent เยอะเกินไป

เช่น 15-20 agents

จะเจอ:

orchestration complexity
latency
prompt mismatch
cost สูง
debug ยาก

และ quality ไม่ได้เพิ่มตาม linear

แนวคิดที่สำคัญมาก

Agent ไม่ควรแบ่งตาม “LLM”
แต่แบ่งตาม “responsibility”

เช่น:

generate
review
validate
assemble

นี่คือ design ที่ scalable จริง

ถ้าทำ production จริง

หลายระบบเริ่มไปทาง:

Layer	ใช้อะไร
Orchestrator	n8n / LangGraph
Main reasoning	GPT / Claude
Cheap validator	smaller model
Rule engine	deterministic
Psychometric	Python pipeline
Design ที่ผมแนะนำมากที่สุดตอนนี้
Core Pipeline

Blueprint
→ Generator
→ Distractor
→ Judge
→ Rule Validator
→ Assembly

นี่ balance ดีมากระหว่าง:

quality
cost
maintainability
scalability
จุดที่สำคัญกว่า “จำนวน agents”

คือ:

มี deterministic layer มั้ย

เพราะถ้าทุกอย่างใช้ LLM หมด:
ระบบจะ unstable มาก

ควรมี:

readability formulas
vocab frequency lists
CEFR vocabulary DB
grammar rule checks
duplicate detection

ร่วมด้วยเสมอ

สรุปสั้นๆ:

เริ่มจริง:

3 agents ก็พอ

ระบบดีระดับ production:

4-6 agents กำลังดีที่สุด

มากกว่า 10:

มักเริ่ม overengineer เว้นแต่คุณทำ research-grade system จริงๆ

จะใช้เครื่องมืออะไรบ้าง

ใช้ชุดนี้กำลังดีครับ สำหรับเริ่มทำจริงแบบไม่บวมเกินไป

Stack แนะนำ
ส่วน	เครื่องมือ
Frontend	React / Next.js
Backend API	FastAPI หรือ Node.js
Database	PostgreSQL
Item Bank	PostgreSQL + JSONB
Vector Search	pgvector
Agent Orchestration	LangGraph หรือ n8n
LLM	OpenAI / Claude / Gemini
LLM Judge	GPT-4.1 / GPT-5.5 / Claude
Rule Validation	Python
Psychometric	Python + py-irt / pandas
Listening TTS	OpenAI TTS / ElevenLabs
File Storage	S3 / Cloudflare R2
Auth	Clerk / Auth.js / Firebase Auth
Admin Dashboard	React + TanStack Table
Deployment	Docker + Render / Railway / Fly.io / AWS
Analytics	PostHog / Metabase
Pipeline เครื่องมือที่ควรมี

สร้างข้อสอบ:

Blueprint Agent
→ Generator Agent
→ Distractor Agent
→ Judge Agent
→ Rule Validator
→ Item Bank

จัดชุดสอบ:

Item Bank
→ Assembly Engine
→ Test Session
→ Response Logging
→ Score Mapping
→ Report

หลังมีข้อมูลผู้สอบ:

Response Data
→ Difficulty Analysis
→ Discrimination Analysis
→ Item Revision
→ Psychometric Calibration
เริ่มแบบง่ายสุด

ถ้าจะทำ MVP:

React
+ FastAPI
+ PostgreSQL
+ OpenAI API
+ Python validation scripts

แค่นี้พอเริ่มสร้างข้อสอบ, ตรวจคุณภาพ, เก็บคลังข้อสอบ, และให้ผู้ใช้ทำข้อสอบได้แล้วครับ.

ส่วนของ Agent จะทำยังไง
Thought for a few seconds

ทำ Agent เป็น “pipeline” ก่อน ไม่ต้องทำให้คุยกันมั่วแบบอิสระ

โครงสร้างแนะนำ:

User/Admin ใส่ requirement
        ↓
Blueprint Agent
        ↓
Generator Agent
        ↓
Distractor Agent
        ↓
Judge Agent
        ↓
Rule Validator
        ↓
Save to Item Bank
1. Blueprint Agent

หน้าที่คือแปลงคำสั่งกว้างๆ ให้เป็น spec ชัดเจน

เช่น input:

สร้างข้อสอบ Reading ระดับ B1 สำหรับพนักงานออฟฟิศ 10 ข้อ

output:

{
  "skill": "reading",
  "cefr": "B1",
  "topic": "workplace communication",
  "passage_length": "120-160 words",
  "question_types": ["main idea", "detail", "inference"],
  "difficulty": "medium",
  "item_count": 10
}
2. Generator Agent

เอา blueprint ไปสร้างเนื้อหา:

{
  "passage": "...",
  "questions": [
    {
      "stem": "What is the main purpose of the email?",
      "correct_answer": "To confirm a meeting time"
    }
  ]
}

ยังไม่ต้องสร้างตัวเลือกทั้งหมดในขั้นนี้ก็ได้

3. Distractor Agent

สร้างตัวลวงแยกต่างหาก

{
  "options": [
    "To confirm a meeting time",
    "To cancel a project",
    "To request a budget increase",
    "To introduce a new employee"
  ],
  "answer": "A"
}

Agent นี้ต้องมี rule ว่า:

ตัวลวงต้องดูเป็นไปได้
ห้ามหลุด topic
ห้ามมี 2 คำตอบถูก
ห้าม obvious เกินไป
4. Judge Agent

ตรวจคุณภาพข้อสอบ

ให้คะแนนประมาณนี้:

{
  "cefr_alignment": 8,
  "ambiguity_risk": "low",
  "distractor_quality": 7,
  "grammar_naturalness": 9,
  "estimated_level": "B1",
  "pass": true,
  "issues": []
}

ถ้าไม่ผ่าน → ส่งกลับไปแก้

5. Rule Validator

อันนี้ไม่ใช่ LLM ควรเป็นโค้ดธรรมดา

ตรวจเช่น:

จำนวนตัวเลือกครบไหม
มี answer ถูกแค่ข้อเดียวไหม
passage ยาวเกินไหม
JSON format ถูกไหม
duplicate ไหม
CEFR vocabulary หลุดไหม
6. Save เข้า Item Bank

เก็บประมาณนี้:

{
  "skill": "reading",
  "cefr": "B1",
  "question_type": "inference",
  "passage": "...",
  "stem": "...",
  "options": [],
  "answer": "A",
  "judge_score": 8.2,
  "status": "draft_validated"
}
วิธี implement แบบง่ายสุด

ใช้ LangGraph จะเหมาะสุด เพราะมันเป็น flow ชัดเจน:

blueprint_node
→ generate_node
→ distractor_node
→ judge_node
→ validator_node
→ save_node

ถ้า judge ไม่ผ่าน:

judge_node
→ revise_node
→ judge_node
MVP ทำแค่นี้พอ

เริ่มจาก 3 Agent ก่อน:

Blueprint Agent
Generator Agent
Judge Agent

แล้วค่อยเพิ่ม:

Distractor Agent
Psychometric Agent
Assembly Agent

สรุปคือ Agent ไม่ควรทำเป็น “หลายตัวคุยกันไปมา” ตั้งแต่แรก
ควรทำเป็น “สายพานผลิตข้อสอบ” ที่แต่ละตัวมีหน้าที่ชัดเจน แบบนี้คุมคุณภาพง่ายกว่าเยอะครับ.