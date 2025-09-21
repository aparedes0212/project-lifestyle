from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("app_workout", "0018_cardioworkoutwarmup_delete_cardiowarmupsettings_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="strengthdailylog",
            name="rph_goal",
            field=models.FloatField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="strengthdailylog",
            name="rph_goal_avg",
            field=models.FloatField(null=True, blank=True),
        ),
    ]

