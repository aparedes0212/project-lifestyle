from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0044_remove_cardioworkout_mph_goal_strategy"),
    ]

    operations = [
        migrations.AddField(
            model_name="cardiodailylog",
            name="mph_goal_avg_percentage",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="cardiodailylog",
            name="mph_goal_percentage",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]

