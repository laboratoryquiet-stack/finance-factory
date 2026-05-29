const express = require('express');
const app = express();
app.use(express.json());

// Basic security: Requires an API_SECRET header
app.post('/process', async (req, res) => {
  const providedSecret = req.headers['x-api-secret'];
  
  if (!providedSecret || providedSecret !== process.env.API_SECRET) {
    return res.status(401).send("Unauthorized");
  }

  // Acknowledge receipt immediately so Pipedream doesn't time out
  res.status(202).send({ message: "Job accepted" });

  console.log("Processing video job:", req.body.title);
  
  try {
    // Your FFmpeg and rendering logic will go here
  } catch (error) {
    console.error("Processing failed:", error);
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`Factory running on port ${port}`));
