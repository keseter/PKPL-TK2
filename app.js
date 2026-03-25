const express = require("express");
const path = require("path");
const members = require("./data/members");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("index", {
    groupName: "Kelompok 01",
    courseName: "Project 2: Authentication & Authorization",
    members: members,
    isLoggedIn: false,
    user: null,
    theme: {
      bgColor: "#f5f7fb",
      textColor: "#1f2937",
      cardColor: "#ffffff",
      fontFamily: "Arial, sans-serif"
    }
  });
});

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server berjalan di port ${PORT}`);
});