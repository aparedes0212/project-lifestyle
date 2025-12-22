from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0031_rename_three_mile_time_goal_time"),
    ]

    operations = [
        migrations.AddField(
            model_name="cardioworkout",
            name="mph_goal_strategy",
            field=models.CharField(
                choices=[
                    ("progression_max_avg", "Progression: pick log with highest avg; use that log's max/avg"),
                    ("progression_max_max", "Progression: pick log with highest max; use that log's max/avg"),
                    ("routine_max_avg", "Routine: pick log with highest avg; use that log's max/avg"),
                    ("routine_max_max", "Routine: pick log with highest max; use that log's max/avg"),
                    ("workout_max_avg", "Workout: pick log with highest avg; use that log's max/avg"),
                    ("workout_max_max", "Workout: pick log with highest max; use that log's max/avg"),
                ],
                default="progression_max_avg",
                max_length=40,
            ),
        ),
    ]
