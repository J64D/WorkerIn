ThisBuild / scalaVersion := "3.9.0"
ThisBuild / organization := "br.com.workerin"
ThisBuild / version := "0.1.0"

lazy val root = (project in file("."))
  .settings(
    name := "workerin-analytics",
    libraryDependencies += "com.lihaoyi" %% "ujson" % "3.3.1"
  )
