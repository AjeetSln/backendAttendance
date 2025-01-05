const express = require('express');
const nodemailer = require('nodemailer');
const router = express.Router();

// POST endpoint to send emails
router.post('/send', async (req, res) => {
  const { to, subject, body } = req.body;

  // Check if required fields are provided
  if (!to || !subject || !body) {
    return res.status(400).json({ error: 'Please provide to, subject, and body fields.' });
  }

  try {
    // Create a transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail', // Replace with your email service (e.g., Outlook, Yahoo, etc.)
      auth: {
        user: process.env.EMAIL_USER, // Your email
        pass: process.env.EMAIL_PASSWORD, // Your email password or app password
      },
    });

    // Email options
    const mailOptions = {
      from: process.env.EMAIL_USER, // Sender email
      to: to, // Recipient email
      subject: subject,
      text: body, // Plain text body
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);

    console.log('Email sent:', info.response);
    res.status(200).json({ message: 'Email sent successfully.' });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: 'Error sending email. Please try again later.' });
  }
});

module.exports = router;
