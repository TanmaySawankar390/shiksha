require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // Add this for Node.js < 18

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Check for API key
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
    throw new Error("GOOGLE_API_KEY not found in .env file.");
}

// Configure Gemini AI
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Changed to pro-vision

app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: "Welcome to the API!" });
});

async function fileToGenerativePart(buffer, mimeType) {
    return {
        inlineData: {
            data: buffer.toString('base64'),
            mimeType
        }
    };
}

async function extractQAFromImage(imageBuffer) {
    try {
        // Convert image to proper format
        const processedImage = await sharp(imageBuffer)
            .resize(1024, 1024, { fit: 'inside' }) // Resize to reasonable dimensions
            .toFormat('jpeg')
            .toBuffer();

        // Create generative part
        const imagePart = await fileToGenerativePart(processedImage, 'image/jpeg');

        // Prompt for structured output
        const prompt = `Extract all question-answer pairs from the image. 
            Return the output in this structured format:
            Q1: <question>
            A1: <answer>
            Q2: <question>
            A2: <answer>
            Continue this format for all questions.`;

        // Generate content with proper error handling
        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const extractedText = response.text().trim();

        if (!extractedText) {
            return [{ question: "No questions detected", answer: "No answers detected" }];
        }

        const lines = extractedText.split('\n');
        const qaList = [];

        for (let i = 0; i < lines.length - 1; i += 2) {
            if (lines[i].startsWith('Q') && lines[i + 1]?.startsWith('A')) {
                const question = lines[i].split(':')[1]?.trim() || '';
                const answer = lines[i + 1].split(':')[1]?.trim() || '';
                if (question && answer) {
                    qaList.push({ question, answer });
                }
            }
        }

        return qaList.length > 0 ? qaList : [{ question: "No questions detected", answer: "No answers detected" }];
    } catch (error) {
        console.error('Error processing image:', error);
        throw new Error(`Failed to process image: ${error.message}`);
    }
}

// Handle image upload
app.post('/extract_qa', upload.single('image'), async (req, res) => {
    try {
        let imageBuffer;

        if (req.file) {
            // Handle multipart form data upload
            imageBuffer = req.file.buffer;
        } else if (req.body.image_path) {
            // Handle image path from JSON
            const imagePath = req.body.image_path;
            if (!fs.existsSync(imagePath)) {
                return res.status(400).json({ error: "Image file not found" });
            }
            imageBuffer = await fs.promises.readFile(imagePath);
        } else {
            return res.status(400).json({ error: "No valid image provided" });
        }

        const qaList = await extractQAFromImage(imageBuffer);
        res.json({ questions_answers: qaList });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ 
            error: "Internal server error", 
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});